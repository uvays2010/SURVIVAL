import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class FirestoreErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let msg = error.message || 'Unexpected application error';
    try {
      const parsed = JSON.parse(msg) as { error?: string; operationType?: string; path?: string };
      if (parsed && parsed.error) {
        msg = `${parsed.operationType ?? 'op'} (${parsed.path ?? 'db'}): ${parsed.error}`;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, message: msg };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b0e11] p-6 text-stone-100">
          <div className="max-w-md w-full rounded-xl border border-white/15 bg-[#12171d] p-6 shadow-2xl flex flex-col gap-3">
            <h2 className="font-display text-lg font-semibold text-amber-400">
              TIRIK QOLISH: YO‘QOLGAN DUNYO
            </h2>
            <p className="text-xs text-stone-300 break-words leading-relaxed">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-1 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-stone-950 transition-colors cursor-pointer w-fit"
            >
              Qayta yuklash / Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
