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
  readOnly
}: FormFieldProps) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        readOnly={readOnly}
        className="w-full rounded-lg border border-border-dark bg-background-dark px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary read-only:cursor-not-allowed read-only:opacity-70"
      />
      {helperText ? <span className="mt-1 block text-xs text-slate-500">{helperText}</span> : null}
    </label>
  );
}
