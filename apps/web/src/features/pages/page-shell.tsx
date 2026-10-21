import type { ReactNode } from "react";

export function PageShell({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-xl tracking-tight">{title}</h1>
            {description && <p className="mt-1 max-w-xl text-muted-foreground text-sm">{description}</p>}
          </div>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}
