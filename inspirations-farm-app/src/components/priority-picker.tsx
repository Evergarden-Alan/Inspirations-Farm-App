export type Priority = "p0" | "p1" | "p2" | "p3";

const PRIORITIES: Priority[] = ["p0", "p1", "p2", "p3"];

interface PriorityPickerProps {
  value: Priority;
  onChange: (priority: Priority) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}

export function PriorityPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
  label = "优先级",
}: PriorityPickerProps) {
  return (
    <div className="farm-priority-picker" role="group" aria-label={label}>
      {!compact && (
        <span className="mr-0.5 shrink-0 text-[10px] font-semibold tracking-[0.12em] text-[var(--farm-muted)]">
          {label}
        </span>
      )}
      {PRIORITIES.map((priority) => (
        <button
          key={priority}
          type="button"
          data-priority={priority}
          aria-pressed={value === priority}
          aria-label={`${label} ${priority.toUpperCase()}`}
          disabled={disabled}
          onClick={() => onChange(priority)}
          className="farm-priority-option touch-manipulation disabled:opacity-45"
        >
          {priority.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
