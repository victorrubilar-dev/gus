import { CalendarClock } from "lucide-react";
import { useT } from "../lib/i18n";
import DashboardCard from "./DashboardCard";

interface DashboardDailyProps {
  /** `null` mientras se mira, `false` si hoy no hay nota y las líneas de su vista previa si la hay. */
  note: string[] | false | null;
  dateLabel: string;
  onOpen: () => void;
}

/** La nota del día: abrirla si existe o empezarla si no. */
export default function DashboardDaily({ note, dateLabel, onOpen }: DashboardDailyProps) {
  const t = useT();
  const exists = note !== false && note !== null;

  return (
    <DashboardCard icon={CalendarClock} title={t("dashboard.dailyTitle")}>
      <p className="text-meta text-gus-muted first-letter:uppercase">{dateLabel}</p>
      {note === null && <p className="text-body text-gus-muted">{t("common.loading")}</p>}
      {note === false && <p className="text-body text-gus-muted">{t("dashboard.dailyNotYet")}</p>}
      {exists && note.length === 0 && <p className="text-body text-gus-muted">{t("dashboard.dailyEmpty")}</p>}
      {exists && note.length > 0 && (
        <div className="space-y-0.5">
          {note.map((line, index) => (
            <p key={index} className="truncate text-body text-gus-text">
              {line}
            </p>
          ))}
        </div>
      )}
      {note !== null && (
        <div>
          <button type="button" onClick={onOpen} className={exists ? "gus-btn gus-btn-secondary" : "gus-btn gus-btn-primary"}>
            {exists ? t("dashboard.dailyOpen") : t("dashboard.dailyWrite")}
          </button>
        </div>
      )}
    </DashboardCard>
  );
}
