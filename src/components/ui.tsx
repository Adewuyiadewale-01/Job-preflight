import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SVGProps,
} from "react";
import { cx } from "../lib/utils";
import type { Verdict } from "../lib/types";
import { VERDICT_META } from "../lib/verdict";

/* ------------------------------------------------------------------ */
/* Icons — hand-drawn inline SVG                                       */
/* ------------------------------------------------------------------ */

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}
const Svg = ({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);

export const IcRadar = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.6" opacity="0.55" />
    <path d="M12 12 18.6 5.4" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const IcSend = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 3 10.2 13.8" />
    <path d="M21 3l-6.8 18-3.9-7.2L3 9.8 21 3z" />
  </Svg>
);
export const IcBrief = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7.5" width="18" height="13" rx="2" />
    <path d="M8.5 7.5V5.6A1.6 1.6 0 0 1 10.1 4h3.8a1.6 1.6 0 0 1 1.6 1.6v1.9" />
    <path d="M3 12.5h18" opacity="0.55" />
  </Svg>
);
export const IcMail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </Svg>
);
export const IcSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h13M20.5 17H21" />
    <circle cx="15.5" cy="7" r="2" />
    <circle cx="9.5" cy="12" r="2" />
    <circle cx="18.5" cy="17" r="2" />
  </Svg>
);
export const IcCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);
export const IcX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IcAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 22 20H2L12 3.5z" />
    <path d="M12 10v4.5" />
    <circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);
export const IcClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2.2" />
  </Svg>
);
export const IcCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 5.5v-1a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" transform="translate(1 1)" />
  </Svg>
);
export const IcPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IcTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" />
    <path d="M6.5 7l.8 12.2A1.8 1.8 0 0 0 9.1 21h5.8a1.8 1.8 0 0 0 1.8-1.8L17.5 7" />
    <path d="M10 11v6M14 11v6" opacity="0.6" />
  </Svg>
);
export const IcPen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z" />
    <path d="m14.5 6.5 3 3" opacity="0.6" />
  </Svg>
);
export const IcPaperclip = (p: IconProps) => (
  <Svg {...p}>
    <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7L13 4.5a3.4 3.4 0 0 1 4.8 4.8L10.5 16.6a1.8 1.8 0 0 1-2.5-2.5l6.8-6.8" />
  </Svg>
);
export const IcShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 5 5.8v5.4c0 4.4 3 7.8 7 9.3 4-1.5 7-4.9 7-9.3V5.8L12 3z" />
    <path d="m9 11.7 2.2 2.2 4-4.4" />
  </Svg>
);
export const IcInbox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 13.5 5.5 5h13L21 13.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4.5z" />
    <path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" />
  </Svg>
);
export const IcChev = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);
export const IcLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
);
export const IcDoc = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h8l4 4v14H6V3z" />
    <path d="M14 3v4h4" />
    <path d="M9 12h6M9 15.5h6" opacity="0.6" />
  </Svg>
);
export const IcPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.8v14.4L19 12 7 4.8z" />
  </Svg>
);
export const IcStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </Svg>
);
export const IcLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4L11.5 6.5" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5" />
  </Svg>
);
export const IcRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 3v4h-4" />
  </Svg>
);

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

export type LampState = "off" | "ok" | "warn" | "fail" | "live";

export function Lamp({ state, size = 9, pulse = true }: { state: LampState; size?: number; pulse?: boolean }) {
  const tone =
    state === "ok"
      ? "bg-grn shadow-[0_0_8px_rgba(61,220,151,0.8)]"
      : state === "warn"
        ? cx("bg-amb shadow-[0_0_8px_rgba(255,180,84,0.8)]", pulse && "lamp-warn-pulse")
        : state === "fail"
          ? cx("bg-red shadow-[0_0_8px_rgba(255,97,97,0.85)]", pulse && "lamp-fail-pulse")
          : state === "live"
            ? "bg-cy shadow-[0_0_8px_rgba(76,195,232,0.8)] animate-pulse"
            : "bg-[#33415e]";
  return <span className={cx("inline-block rounded-full shrink-0", tone)} style={{ width: size, height: size }} />;
}

const BTN_VARIANTS = {
  primary:
    "bg-cy text-[#06222e] font-semibold hover:bg-[#6fd3f0] active:translate-y-px shadow-[0_2px_14px_rgba(76,195,232,0.25)]",
  ok: "bg-grn text-[#062e1c] font-semibold hover:bg-[#63e6ae] active:translate-y-px shadow-[0_2px_14px_rgba(61,220,151,0.25)]",
  danger:
    "bg-red/12 text-red border border-red/35 hover:bg-red/20 active:translate-y-px font-medium",
  ghost:
    "border border-edge text-mut hover:text-fog hover:border-edge2 hover:bg-raise/50 active:translate-y-px",
  warn: "bg-amb/12 text-amb border border-amb/35 hover:bg-amb/20 active:translate-y-px font-medium",
} as const;

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BTN_VARIANTS;
  size?: "sm" | "md" | "lg";
}
export function Btn({ variant = "ghost", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-all duration-150 select-none",
        "disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" && "text-xs px-2.5 py-1.5",
        size === "md" && "text-sm px-3.5 py-2",
        size === "lg" && "text-[15px] px-5 py-2.5",
        BTN_VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const CHIP_TONES = {
  ok: "bg-grn/10 text-grn border-grn/30",
  warn: "bg-amb/10 text-amb border-amb/30",
  fail: "bg-red/10 text-red border-red/30",
  info: "bg-cy/10 text-cy border-cy/30",
  neutral: "bg-raise/60 text-mut border-edge",
} as const;

export function Chip({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof CHIP_TONES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider",
        CHIP_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function VerdictPill({ verdict, size = "md" }: { verdict: Verdict; size?: "sm" | "md" }) {
  const tone = verdict === "safe" ? "ok" : verdict === "review" ? "warn" : "fail";
  const lamp = verdict === "safe" ? "ok" : verdict === "review" ? "warn" : "fail";
  return (
    <Chip tone={tone} className={size === "md" ? "px-2.5 py-1 text-xs" : ""}>
      <Lamp state={lamp} size={7} pulse={false} />
      {VERDICT_META[verdict].label}
    </Chip>
  );
}

export function ProgressBar({ pct, tone = "cy" }: { pct: number; tone?: "cy" | "grn" | "amb" | "red" }) {
  const color =
    tone === "grn" ? "bg-grn" : tone === "amb" ? "bg-amb" : tone === "red" ? "bg-red" : "bg-cy";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge/50">
      <div
        className={cx("h-full rounded-full transition-[width] duration-300 ease-out", color)}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2.5"
    >
      <span
        className={cx(
          "relative h-[20px] w-[36px] rounded-full border transition-colors duration-200",
          checked ? "bg-cy/25 border-cy/60" : "bg-raise border-edge"
        )}
      >
        <span
          className={cx(
            "absolute top-[2.5px] h-[13px] w-[13px] rounded-full transition-all duration-200",
            checked ? "left-[18px] bg-cy shadow-[0_0_8px_rgba(76,195,232,0.7)]" : "left-[3px] bg-dim"
          )}
        />
      </span>
      {label && <span className="text-sm text-mut group-hover:text-fog transition-colors">{label}</span>}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  kicker,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  kicker?: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[9vh]">
      <div className="fixed inset-0 bg-pit/80 backdrop-blur-[3px] anim-fade" onClick={onClose} />
      <div className={cx("relative w-full panel anim-rise shadow-2xl shadow-black/60", width)}>
        <div className="flex items-start justify-between border-b border-edge px-5 py-4">
          <div>
            {kicker && (
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-cy mb-1">{kicker}</div>
            )}
            <h3 className="font-disp text-lg font-semibold text-fog">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 rounded-md p-1.5 text-dim hover:bg-raise hover:text-fog transition-colors"
            aria-label="Close dialog"
          >
            <IcX size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function SectionHead({
  kicker,
  title,
  right,
}: {
  kicker: string;
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-cy/90 mb-1.5">{kicker}</div>
        <h2 className="font-disp text-[22px] leading-none font-bold text-fog">{title}</h2>
      </div>
      {right}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-edge px-6 py-10 text-center">
      <div className="mb-3 text-dim">{icon}</div>
      <div className="font-disp font-semibold text-fog">{title}</div>
      <p className="mt-1 max-w-sm text-[13px] text-mut">{hint}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

type ToastKind = "ok" | "warn" | "err";
interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}
let pushToast: ((t: ToastItem) => void) | null = null;

export function toast(msg: string, kind: ToastKind = "ok") {
  pushToast?.({ id: Date.now() + Math.random(), msg, kind });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((xs) => [...xs.slice(-3), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 3800);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            "anim-toast pointer-events-auto flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-xl shadow-black/50 backdrop-blur",
            t.kind === "ok" && "border-grn/40 bg-[#0d2018]/95 text-grn",
            t.kind === "warn" && "border-amb/40 bg-[#241b0b]/95 text-amb",
            t.kind === "err" && "border-red/40 bg-[#251012]/95 text-red"
          )}
        >
          {t.kind === "ok" ? <IcCheck size={15} /> : t.kind === "warn" ? <IcAlert size={15} /> : <IcX size={15} />}
          <span className="text-fog">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
