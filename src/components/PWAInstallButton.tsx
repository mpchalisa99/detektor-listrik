import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 font-mono text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        title="Install PWA ke Perangkat"
      >
        <Download className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span>Install PWA</span>
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="min-h-[40px] px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 font-mono text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        title="Panduan Instalasi PWA"
      >
        <Smartphone className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span>Install PWA</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-[#0A1120] border border-slate-800 p-5 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                <h3 className="font-mono text-sm font-bold tracking-wide text-slate-100">
                  INSTALASI TACTICAL PWA
                </h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
                aria-label="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-slate-300 leading-relaxed">
              {isIOS ? (
                <>
                  <p className="text-slate-200 font-medium">
                    Cara memasang aplikasi di iPhone / iPad (Safari):
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-300 font-mono">
                    <li>Ketuk tombol <strong>Share</strong> di bilah navigasi Safari.</li>
                    <li>Gulir ke bawah dan pilih <strong>Add to Home Screen</strong>.</li>
                    <li>Ketuk <strong>Add</strong> di pojok kanan atas.</li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="text-slate-200 font-medium">
                    Cara memasang aplikasi di Android (POCO X8 Pro / Chrome):
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-300 font-mono">
                    <li>Buka aplikasi di tab penuh Chrome Android (HTTPS).</li>
                    <li>Ketuk ikon menu <strong>⋮</strong> di pojok kanan atas Chrome.</li>
                    <li>Pilih <strong>Install app</strong> atau <strong>Tambahkan ke layar utama</strong>.</li>
                  </ol>
                </>
              )}
            </div>

            <button
              onClick={() => setShowModal(false)}
              className="mt-5 w-full min-h-[42px] rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono text-xs font-bold transition-colors cursor-pointer"
            >
              MENGERTI
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-950/90 border border-amber-500/50 px-3 py-2 text-xs font-mono text-amber-200 shadow-lg">
      <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
      <span>OFFLINE MODE · Menggunakan cache PWA lokal</span>
    </div>
  );
};
