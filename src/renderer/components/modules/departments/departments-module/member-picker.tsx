import { t } from "@shared/l10n";
import type { Employee } from "@shared/types";
import { useMemo, useState } from "react";
import { EmployeeAvatar } from "../../../employee-avatar";
import { Modal } from "../../../modal";

export interface MemberPickerProps {
  /** Department to staff, or null when closed. */
  departmentId: number | null;
  departmentName: string;
  employees: Employee[];
  /** Employees already in this department (excluded from the picker). */
  existingIds: number[];
  onClose: () => void;
  /** Add one employee to the department (kept open for adding several). */
  onAdd: (employeeId: number) => void;
}

/**
 * Modal that lists the staff not yet in a department, filtered by a search box.
 * Picking someone adds them and keeps the dialog open so several can be added
 * in a row; re-presenting an employee in other departments is how "兼任" works.
 */
export function MemberPicker({
  departmentId,
  departmentName,
  employees,
  existingIds,
  onClose,
  onAdd,
}: MemberPickerProps): React.JSX.Element {
  const [query, setQuery] = useState("");

  const candidates = useMemo(() => {
    const taken = new Set(existingIds);
    const needle = query.trim().toLowerCase();
    return employees.filter((employee) => {
      if (taken.has(employee.id)) return false;
      if (!needle) return true;
      return (
        employee.name.toLowerCase().includes(needle) ||
        employee.role.toLowerCase().includes(needle)
      );
    });
  }, [employees, existingIds, query]);

  return (
    <Modal
      open={departmentId !== null}
      onClose={onClose}
      title={t("Add members to ${name}", { name: departmentName })}
    >
      <div className="imb-dept-picker">
        <input
          className="imb-dept-picker-search"
          value={query}
          placeholder={t("Filter by name or role")}
          aria-label={t("Filter by name or role")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="imb-dept-picker-list">
          {candidates.length === 0 && (
            <p className="imb-dept-picker-empty">
              {t("No matching employees")}
            </p>
          )}
          {candidates.map((employee) => (
            <button
              type="button"
              className="imb-dept-picker-row"
              key={employee.id}
              onClick={() => onAdd(employee.id)}
            >
              <EmployeeAvatar employeeId={employee.id} size={26} />
              <span className="imb-dept-member-text">
                <span className="imb-dept-member-name">
                  {employee.name || t("Unnamed")}
                </span>
                <span className="imb-dept-member-role">
                  {employee.role || "—"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
