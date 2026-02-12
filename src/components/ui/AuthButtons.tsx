interface AuthButtonsProps {
  onGoogle: () => Promise<void>;
  submitting: boolean;
  submitLabel: string;
}

export function AuthButtons({ onGoogle, submitting, submitLabel }: AuthButtonsProps) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void onGoogle()}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-3 font-semibold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
      >
        <img src="/google_logo.png" alt="Google logo" className="h-5 w-5 object-contain" />
        Continue with Google
      </button>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-primary py-3 font-bold text-background-dark transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-70"
      >
        {submitting ? "Working..." : submitLabel}
      </button>
    </div>
  );
}
