/** 开关（toggle）：thumb 位移带过冲回弹（motion token），暗亮色一致。 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  tone = "accent",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  tone?: "accent" | "neutral";
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-(--duration-fast) motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent) disabled:cursor-not-allowed disabled:opacity-45 ${
        checked ? tone === "neutral" ? "bg-(--color-brand)" : "bg-(--color-accent)" : "bg-(--color-border)"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 left-0.5 size-4 rounded-full shadow-(--shadow-pop) transition-transform duration-(--duration-fast) ease-(--ease-bounce) motion-reduce:transition-none ${tone === "neutral" ? "bg-(--color-inverse)" : "bg-(--color-neutral-50)"} ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
