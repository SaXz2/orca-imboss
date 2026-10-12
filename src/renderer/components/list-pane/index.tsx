import type { ReactNode } from "react";
import "./index.css";

export interface ListPaneProps {
  title: ReactNode;
  /** Secondary actions rendered on the title row, right-aligned. */
  actions?: ReactNode;
  search?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Col 2: module title + search + scrollable list + footer. */
export function ListPane({
  title,
  actions,
  search,
  children,
  footer,
}: ListPaneProps): React.JSX.Element {
  return (
    <>
      <div className="imb-pane-header">
        <div className="imb-pane-titlebar">
          <div className="imb-pane-title">{title}</div>
          {actions !== undefined && (
            <div className="imb-pane-actions">{actions}</div>
          )}
        </div>
        {search}
      </div>
      <div className="imb-list">{children}</div>
      {footer !== undefined && <div className="imb-pane-footer">{footer}</div>}
    </>
  );
}
