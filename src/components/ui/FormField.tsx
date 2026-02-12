import { useState } from "react";

interface FormFieldProps {
  label: string;
  id: string;
  type?: React.HTMLInputTypeAttribute;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  required?: boolean;
  readOnly?: boolean;
  showPasswordToggle?: boolean;
}

export function FormField({
  label,
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  helperText,
  required,
  readOnly,
  showPasswordToggle = false
}: FormFieldProps) {
  const [isPasswordVisible, setPasswordVisible] = useState(false);
  const isPasswordField = type === "password" && showPasswordToggle;
  const inputType = isPasswordField && isPasswordVisible ? "text" : type;

  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <div className="relative">
        <input
          id={id}
          type={inputType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          readOnly={readOnly}
          className={`w-full rounded-lg border border-border-dark bg-background-dark px-4 py-3 text-sm text-white placeholder:text-slate-500/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary focus:placeholder-transparent read-only:cursor-not-allowed read-only:opacity-70 ${
            isPasswordField ? "pr-12" : ""
          }`}
        />
        {isPasswordField ? (
          <button
            type="button"
            aria-label={isPasswordVisible ? "Hide password" : "Show password"}
            onClick={() => setPasswordVisible((current) => !current)}
            className="absolute inset-y-0 right-0 px-3 text-slate-400 transition-colors hover:text-white"
          >
            <span className="material-icons text-base" aria-hidden="true">
              {isPasswordVisible ? "visibility_off" : "visibility"}
            </span>
          </button>
        ) : null}
      </div>
      {helperText ? <span className="mt-1 block text-xs text-slate-500">{helperText}</span> : null}
    </label>
  );
}
