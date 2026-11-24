import type { ReactNode } from "react";

interface EmptyAction {
  label: string;
  onClick(): void;
}

interface Props {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: EmptyAction;
  secondary?: EmptyAction;
}

/** Centered "nothing here" panel that always offers the next step. */
export function EmptyState({ icon, title, body, action, secondary }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-accent">
        {icon}
      </div>
      <h2 className="mt-4 text-[14px] font-semibold text-fg">{title}</h2>
      {body && (
        <p className="mt-1.5 max-w-[320px] text-[12px] leading-relaxed text-fg-muted">{body}</p>
      )}
      {(action || secondary) && (
        <div className="mt-5 flex items-center gap-2">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-fg transition hover:brightness-110"
            >
              {action.label}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              className="h-9 rounded-lg px-3 text-[13px] text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
