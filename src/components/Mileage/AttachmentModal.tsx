import React, { useState, useEffect } from 'react';
import { sniffMime, withSafeType, UNSUPPORTED_FILE_MSG } from '../../lib/fileSafety';
import { formatRoute } from '../../lib/route';
import { MileageEntry, Attachment } from '../../types/fleet';
import { useFleet } from '../../context/FleetContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../ui/ConfirmDialog';
import { loadAttachmentBlob, MAX_ATTACHMENT_BYTES, shrinkImageIfNeeded } from '../../lib/attachmentStore';
import {
  X,
  Upload,
  FileText,
  Image as ImageIcon,
  Download,
  Trash2,
  Eye,
  FileCheck,
  Tag,
  AlertCircle
} from 'lucide-react';

interface AttachmentModalProps {
  entry: MileageEntry | null;
  isOpen: boolean;
  /** miesiąc zamknięty: można dodać dowód, ale nie można go usunąć */
  isLocked?: boolean;
  onClose: () => void;
}

export const AttachmentModal: React.FC<AttachmentModalProps> = ({
  entry,
  isOpen,
  isLocked = false,
  onClose,
}) => {
  const { addAttachmentToEntry, removeAttachmentFromEntry, activeVehicle } = useFleet();
  const { currentUser } = useAuth();
  const confirm = useConfirm();

  const [selectedCategory, setSelectedCategory] = useState<'faktura' | 'bilet' | 'serwis' | 'inny'>('faktura');
  const [description, setDescription] = useState('');
  const [previewAttachment, setPreviewAttachment] = useState<{
    attachment: Attachment;
    url: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewAttachment?.url && previewAttachment.url.startsWith('blob:')) {
        URL.revokeObjectURL(previewAttachment.url);
      }
    };
  }, [previewAttachment]);

  if (!isOpen || !entry) return null;

  const loadBlob = async (att: Attachment) => {
    if (!currentUser || !activeVehicle) return null;
    return loadAttachmentBlob(currentUser.uid, activeVehicle.id, att);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUploading(true);
    setError(null);
    try {
      const real = await sniffMime(file);
      if (!real) throw new Error(UNSUPPORTED_FILE_MSG);
      const blob = await withSafeType(await shrinkImageIfNeeded(new File([file], file.name, { type: real })));
      if (blob.size > MAX_ATTACHMENT_BYTES) {
        throw new Error('Maksymalny rozmiar pliku to 10 MB.');
      }
      const newAttachment: Attachment = {
        id: `att_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: blob === file ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg',
        size: blob.size,
        type: blob.type,
        category: selectedCategory,
        description: description.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      await addAttachmentToEntry(entry.id, newAttachment, blob);
      setDescription('');
    } catch (err) {
      console.error('Błąd podczas zapisywania załącznika:', err);
      setError(err instanceof Error ? err.message : 'Wystąpił błąd podczas dodawania pliku.');
    } finally {
      setIsUploading(false);
    }
  };

  const handlePreview = async (att: Attachment) => {
    try {
      const blob = await loadBlob(att);
      if (!blob) throw new Error('Nie znaleziono pliku.');
      setPreviewAttachment({ attachment: att, url: URL.createObjectURL(blob) });
    } catch (err) {
      console.error('Błąd pobierania załącznika:', err);
      setError('Nie udało się wczytać pliku.');
    }
  };

  const handleDownload = async (att: Attachment) => {
    try {
      const blob = await loadBlob(att);
      if (!blob) throw new Error('Nie znaleziono pliku.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      console.error('Błąd pobierania:', err);
      setError('Nie udało się pobrać pliku.');
    }
  };

  const handleRemove = async (att: Attachment) => {
    const r = await confirm({ title: `Usunąć załącznik „${att.name}”?`, tone: 'danger', confirmLabel: 'Usuń' });
    if (!r.ok) return;
    try {
      await removeAttachmentFromEntry(entry.id, att.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć pliku.');
    }
  };

  const attachments = entry.attachments || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Nagłówek modalu */}
        <div className="px-6 py-4 bg-side text-white flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-blue-400" />
              <h2 className="font-bold text-base">Dowody celowości wyjazdu dla celów VAT</h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Wpis nr {entry.entryNumber} · {entry.date} · {formatRoute(entry.routeDescription)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Treść z przewijaniem */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Informacja prawna VAT-26 */}
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-start gap-2.5">
            <Tag className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold">Znaczenie dowodowe: </span>
              Załączenie faktury, biletu na targi, wezwania urzędowego lub zlecenia serwisowego stanowi dla Urzędu Skarbowego
              niezbędny dowód, że pojazd był wykorzystywany <strong>wyłącznie do działalności gospodarczej</strong> (odliczenie 100% VAT).
            </div>
          </div>

          {/* Formularz dodawania nowego załącznika */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider">
              Dodaj dokument potwierdzający
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kategoria dowodu</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value as any)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand"
                >
                  <option value="faktura">Faktura VAT / Rachunek / Paragon z NIP</option>
                  <option value="bilet">Bilet (targi, szkolenie, konferencja)</option>
                  <option value="serwis">Zlecenie serwisowe / Protokół naprawy</option>
                  <option value="inny">Inny dokument firmowy</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Krótki opis / nr dokumentu</label>
                <input
                  type="text"
                  placeholder="np. Faktura za towary FV/12/2023"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between">
              <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-medium transition-colors shadow-xs">
                <Upload className="w-4 h-4" />
                <span>{isUploading ? 'Zapisywanie...' : 'Wybierz plik (PDF, JPG, PNG)'}</span>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="hidden"
                />
              </label>
              <span className="text-[11px] text-slate-400">PDF lub zdjęcia do 10 MB (duże zdjęcia zmniejszamy automatycznie)</span>
            </div>

            {error && (
              <div className="p-2 bg-red-50 text-red-700 text-xs rounded border border-red-200 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Lista załączonych dokumentów */}
          <div>
            <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider mb-2">
              Załączone dokumenty do tej trasy ({attachments.length})
            </h3>

            {attachments.length === 0 ? (
              <div className="p-6 text-center border-2 border-dashed border-slate-200 rounded-xl text-xs text-slate-400">
                Brak załączonych dokumentów. Wgraj fakturę lub bilet powyżej, aby wzmocnić dowodowo ten wyjazd.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
                {attachments.map((att) => (
                  <div key={att.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-blue-50 text-brand flex items-center justify-center shrink-0">
                        {att.type.includes('pdf') ? (
                          <FileText className="w-4 h-4" />
                        ) : (
                          <ImageIcon className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 truncate" title={att.name}>
                          {att.name}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          <span className="capitalize font-medium text-brand">{att.category}</span>
                          <span>·</span>
                          <span className="font-num">{(att.size / 1024).toFixed(1)} KB</span>
                          {att.description && (
                            <>
                              <span>·</span>
                              <span className="text-slate-600 italic truncate max-w-xs">{att.description}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handlePreview(att)}
                        className="p-1.5 text-slate-600 hover:text-brand hover:bg-blue-50 rounded-md transition-colors"
                        title="Podgląd dokumentu"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDownload(att)}
                        className="p-1.5 text-slate-600 hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                        title="Pobierz plik"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemove(att)}
                        disabled={isLocked}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                        title="Usuń dokument"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal podglądu pliku w pełnym oknie */}
        {previewAttachment && (
          <div className="fixed inset-0 z-60 bg-black/80 flex flex-col p-4">
            <div className="flex items-center justify-between text-white pb-3 border-b border-white/20">
              <span className="font-semibold text-sm truncate">{previewAttachment.attachment.name}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(previewAttachment.attachment)}
                  className="px-3 py-1 bg-brand hover:bg-brand-hover text-white rounded text-xs flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Pobierz</span>
                </button>
                <button
                  onClick={() => setPreviewAttachment(null)}
                  className="p-1 text-white/80 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center p-4">
              {previewAttachment.attachment.type.includes('pdf') ? (
                <iframe
                  src={previewAttachment.url}
                  className="w-full h-full max-w-4xl bg-white rounded-lg shadow-xl"
                  title="Podgląd PDF"
                />
              ) : (
                <img
                  src={previewAttachment.url}
                  alt="Podgląd załącznika"
                  className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl bg-white"
                />
              )}
            </div>
          </div>
        )}

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-side text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
