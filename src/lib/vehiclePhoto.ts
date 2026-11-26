/**
 * Zdjęcie pojazdu zapisujemy bezpośrednio w dokumencie pojazdu (Firestore, limit 1 MB),
 * dlatego zmniejszamy je do max 1200 px i kompresujemy do JPEG poniżej ~400 kB.
 */
const MAX_SIDE = 1200;
const MAX_BYTES = 400_000;

export async function photoFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Wybierz plik graficzny (JPG, PNG, HEIC zapisany jako JPG).');
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('Nie udało się odczytać zdjęcia. Spróbuj formatu JPG lub PNG.');
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length * 0.75 < MAX_BYTES) return url;
  }
  throw new Error('Zdjęcie jest za duże nawet po zmniejszeniu – wybierz inne.');
}
