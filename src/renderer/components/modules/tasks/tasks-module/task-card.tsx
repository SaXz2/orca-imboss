import { t } from "@shared/l10n";
import type { BoardCard } from "@shared/types";
import { cls } from "reactutils";
import { EmployeeAvatar } from "../../../employee-avatar";
import {
  IconArchive,
  IconComment,
  IconLike,
  IconPencil,
} from "../../../icons";
import { CLOSE_REASON_KEYS, labelColor } from "./task-meta";

type EmployeeList = readonly {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
}[];

/**
 * One board card. Task cards are draggable and clickable (open the thread);
 * progress-derived cards are read-only and open their per-person step view.
 */
export function TaskCard({
  card,
  employees,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onEdit,
  onArchive,
}: {
  card: BoardCard;
  employees: EmployeeList;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onArchive: () => void;
}): React.JSX.Element {
  const isProgress = card.source === "progress";
  const closed = card.status === "closed";
  const doneSteps = card.steps.filter((s) => s.status === "done").length;
  const totalSteps = card.steps.length;
  const shown = card.assignees.slice(0, 4);
  const extra = card.assignees.length - shown.length;
  const reactions = card.reactions;

  return (
    <div
      className={cls(
        "imb-gh-card",
        isProgress && "imb-is-progress",
        closed && "imb-is-closed",
        dragging && "imb-is-dragging",
      )}
      draggable={!isProgress}
      onDragStart={isProgress ? undefined : onDragStart}
      onDragEnd={isProgress ? undefined : onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="imb-gh-card-title">{card.title}</div>

      {(card.category || totalSteps > 0 || closed) && (
        <div className="imb-gh-card-labels">
          {closed && card.closeReason && (
            <span className="imb-gh-label imb-gh-reason">
              {t(CLOSE_REASON_KEYS[card.closeReason])}
            </span>
          )}
          {card.category && (
            <span
              className="imb-gh-label"
              style={{
                color: labelColor(card.category),
                borderColor: labelColor(card.category),
                background: `color-mix(in srgb, ${labelColor(card.category)} 12%, transparent)`,
              }}
            >
              {card.category}
            </span>
          )}
          {totalSteps > 0 && (
            <span className="imb-gh-steps">
              {t("${done} of ${total} steps", {
                done: String(doneSteps),
                total: String(totalSteps),
              })}
            </span>
          )}
        </div>
      )}

      <div className="imb-gh-card-foot">
        {!isProgress && (
          <span className="imb-gh-ref">{`#${card.refId}`}</span>
        )}
        {card.commentCount > 0 && (
          <span className="imb-gh-stat" title={t("Comments")}>
            <IconComment />
            {card.commentCount}
          </span>
        )}
        {reactions.like > 0 && (
          <span className="imb-gh-stat" title={t("Likes")}>
            <IconLike />
            {reactions.like}
          </span>
        )}
        <span className="imb-gh-assignees">
          {shown.map((id) => (
            <span key={id} className="imb-gh-assignee">
              <EmployeeAvatar employeeId={id} size={20} />
            </span>
          ))}
          {extra > 0 && <span className="imb-gh-more">{`+${extra}`}</span>}
        </span>
        {!isProgress && (
          <button
            type="button"
            className="imb-gh-edit"
            title={t("Edit")}
            aria-label={t("Edit")}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <IconPencil />
          </button>
        )}
        {isProgress && (
          <button
            type="button"
            className="imb-gh-edit"
            title={t("Archive")}
            aria-label={t("Archive")}
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
          >
            <IconArchive />
          </button>
        )}
      </div>
    </div>
  );
}
