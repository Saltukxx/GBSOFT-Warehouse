import type { ReactNode } from "react";

export type PageHeaderProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  context?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
};

export function PageHeader({
  title,
  eyebrow,
  description,
  context,
  primaryAction,
  secondaryActions,
}: PageHeaderProps) {
  return (
    <header className="pageheader">
      <div>
        {eyebrow ? <div className="pageheader__eyebrow">{eyebrow}</div> : null}
        <h1 className="pageheader__title">{title}</h1>
        {description ? <p className="pageheader__desc">{description}</p> : null}
      </div>
      <div className="pageheader__spacer" />
      {context}
      {secondaryActions || primaryAction ? (
        <div className="pageheader__actions">
          {secondaryActions}
          {primaryAction}
        </div>
      ) : null}
    </header>
  );
}
