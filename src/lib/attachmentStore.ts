/**
 * Przechowywanie załączników (faktury, bilety, potwierdzenia z serwisu) w Firestore.
 *
 * Dlaczego nie Firebase Storage? Nowe zasobniki Storage wymagają planu Blaze (płatnego),
 * a projekt z AI Studio działa na planie darmowym. Plik dzielimy więc na fragmenty
 * base64 po ~700 kB (limit dokumentu Firestore to 1 MB):
 *
 *   users/{uid}/vehicles/{vid}/files/{attId}            – metadane
 *   users/{uid}/vehicles/{vid}/files/{attId}/chunks/{n} – fragmenty pliku
 *
 * Kopia pliku trafia też do IndexedDB przeglądarki, żeby podgląd działał od razu.
 */

import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from '../lib/docstore';
import { withSafeType } from './fileSafety';
import { db } from './docstore';
import { Attachment } from '../types/fleet';
import { deleteAttachmentFile, getAttachmentBlob, saveAttachmentFile } from './indexedDbAttachments';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const CHUNK_CHARS = 700_000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      resolve(res.slice(res.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Zmniejsza duże zdjęcia (np. z telefonu) do max 2000 px – paragon dalej czytelny, plik kilka razy mniejszy */
export async function shrinkImageIfNeeded(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 1_500_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

function filesCol(uid: string, vehicleId: string) {
  return collection(db, 'users', uid, 'vehicles', vehicleId, 'files');
}

export async function uploadAttachment(
  uid: string,
  vehicleId: string,
  entryId: string,
  attachment: Attachment,
  blob: Blob
): Promise<Attachment> {
  if (blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Plik jest za duży (maks. 10 MB).');
  }
  const b64 = await blobToBase64(blob);
  const chunkCount = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS));
  const meta: Attachment = { ...attachment, size: blob.size, chunkCount };
  delete meta.dataUrl;

  const fileRef = doc(filesCol(uid, vehicleId), attachment.id);
  // fragmenty zapisujemy partiami (limit rozmiaru jednego commita ~10 MB)
  for (let start = 0; start < chunkCount; start += 8) {
    const batch = writeBatch(db);
    for (let i = start; i < Math.min(chunkCount, start + 8); i++) {
      batch.set(doc(fileRef, 'chunks', String(i)), { i, data: b64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
    }
    await batch.commit();
  }
  await setDoc(fileRef, { ...meta, entryId });
  await saveAttachmentFile(meta, blob).catch(() => undefined);
  return meta;
}

export async function loadAttachmentBlob(uid: string, vehicleId: string, attachment: Attachment): Promise<Blob | null> {
  const cached = await getAttachmentBlob(attachment.id).catch(() => null);
  if (cached?.blob) return withSafeType(cached.blob);

  const snap = await getDocs(collection(db, 'users', uid, 'vehicles', vehicleId, 'files', attachment.id, 'chunks'));
  if (snap.empty) {
    // stare załączniki z wersji z AI Studio mogły mieć dataUrl w samym wpisie
    if (attachment.dataUrl) return withSafeType(await (await fetch(attachment.dataUrl)).blob());
    return null;
  }
  const parts = snap.docs
    .map((d) => d.data() as { i: number; data: string })
    .sort((a, b) => a.i - b.i)
    .map((c) => c.data)
    .join('');
  // typ ustalamy po zawartości, a nie po polu zapisanym w bazie
  const blob = await withSafeType(base64ToBlob(parts, attachment.type));
  await saveAttachmentFile(attachment, blob).catch(() => undefined);
  return blob;
}

export async function removeAttachment(uid: string, vehicleId: string, attachment: Attachment): Promise<void> {
  const fileRef = doc(filesCol(uid, vehicleId), attachment.id);
  const chunks = await getDocs(collection(fileRef, 'chunks'));
  await Promise.all(chunks.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(fileRef);
  await deleteAttachmentFile(attachment.id).catch(() => undefined);
}
