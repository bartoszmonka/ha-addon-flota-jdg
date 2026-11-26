import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useFleet } from '../../context/FleetContext';
import { X, Plus, Check, Trash2, Sparkles, Navigation } from 'lucide-react';

interface AddPurposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPurpose: (purpose: string) => void;
}

export const AddPurposeModal: React.FC<AddPurposeModalProps> = ({
  isOpen,
  onClose,
  onSelectPurpose,
}) => {
  const { savedPurposes, addSavedPurpose, deleteSavedPurpose } = useFleet();

  const [newTitle, setNewTitle] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Spotkanie biznesowe');

  if (!isOpen) return null;

  const handleAddNew = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!newTitle.trim()) return;

    addSavedPurpose(newTitle.trim(), selectedCategory);
    onSelectPurpose(newTitle.trim());
    setNewTitle('');
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Nagłówek */}
        <div className="px-6 py-4 bg-side text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h2 className="font-bold text-sm">Wybierz lub dodaj Cel Wyjazdu</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Formularz dodania nowego celu */}
          <form onSubmit={handleAddNew} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
            <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-brand" />
              <span>Dodaj nowy stały cel wyjazdu</span>
            </div>
            <input
              type="text"
              placeholder="np. Wyjazd serwisowy do instalacji u klienta"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs bg-white focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <div className="flex items-center justify-between gap-2">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-700"
              >
                <option value="Spotkanie biznesowe">Spotkanie biznesowe / Klient</option>
                <option value="Ładowanie / Stacja">Ładowanie / Tankowanie</option>
                <option value="Zakupy firmowe">Zakupy z NIP / Magazyn</option>
                <option value="Prezentacja produktu">Prezentacja produktu</option>
                <option value="Urząd / Bank">Urząd Skarbowy / Bank</option>
                <option value="Inne">Inne operacje firmowe</option>
              </select>

              <button
                type="submit"
                disabled={!newTitle.trim()}
                className="px-3.5 py-1.5 bg-brand hover:bg-brand-hover disabled:opacity-50 text-white rounded text-xs font-medium transition-colors flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Dodaj i wybierz</span>
              </button>
            </div>
          </form>

          {/* Lista zapisanych i nauczonych celów */}
          <div>
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Częste cele wyjazdów (kliknij aby wybrać)
            </div>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white">
              {savedPurposes.map((p) => (
                <div
                  key={p.id}
                  className="p-3 flex items-center justify-between gap-3 hover:bg-blue-50/50 cursor-pointer group transition-colors"
                  onClick={() => {
                    onSelectPurpose(p.title);
                    onClose();
                  }}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Navigation className="w-4 h-4 text-blue-500 shrink-0 mt-0.5 group-hover:text-blue-700" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-800 group-hover:text-blue-900">
                        {p.title}
                      </div>
                      {p.category && (
                        <div className="text-[10px] text-slate-400 mt-0.5">{p.category}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-num">
                      użyto {p.usageCount}x
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSavedPurpose(p.id);
                      }}
                      className="p-1 text-slate-400 hover:text-red-600 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Usuń z listy"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 rounded-md transition-colors"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
