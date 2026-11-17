"use client";
// Remote login window: shows the server-side browser and forwards clicks/typing to it.
// When the platform reports a logged-in dashboard, the connection is finalized.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import SyncProgress from "@/components/SyncProgress";

const W = 1280, H = 800;
const SPECIAL_KEYS = new Set(["Enter", "Backspace", "Delete", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);
interface State { loggedIn: boolean; blocked: boolean; captcha: boolean; url: string }

export default function BrowserConnectDialog({ connectionId, platformName, platformSlug = "blinkit", onClose, onConnected }: {
  connectionId: string; platformName: string; platformSlug?: string; onClose: () => void; onConnected: () => void;
}) {
  const magicLink = platformSlug === "blinkit-ads";
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const base = `/api/connections/${connectionId}/browser`;
  const [frame, setFrame] = useState<string | null>(null);
  const [phase, setPhase] = useState<"starting" | "login" | "finishing" | "done" | "error">("starting");
  const [note, setNote] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const typed = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phaseRef = useRef(phase);
  const doneAt = useRef(0);
  phaseRef.current = phase;

  const send = useCallback((input: Record<string, unknown>) => apiPost(`${base}/input`, input).catch(() => undefined), [base]);

  useEffect(() => {
    let alive = true;
    apiPost(`${base}/start`).then(() => { if (alive) setPhase("login"); boxRef.current?.focus(); })
      .catch((e) => { if (alive) { setPhase("error"); setNote(e instanceof ApiError ? e.message : "Could not open the login window"); } });
    return () => { alive = false; };
  }, [base]);

  // Frames: ~1.5 fps is enough for a login form and cheap for the server.
  useEffect(() => {
    if (phase !== "login" && phase !== "finishing") return;
    let alive = true, url: string | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`${base}/frame`, { credentials: "same-origin", cache: "no-store" });
        if (res.status === 200 && alive) {
          const next = URL.createObjectURL(await res.blob());
          setFrame(next);
          if (url) URL.revokeObjectURL(url);
          url = next;
        }
      } catch { /* transient */ }
      if (alive) setTimeout(tick, 700);
    };
    tick();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [base, phase]);

  // Login detection.
  useEffect(() => {
    if (phase !== "login") return;
    const t = setInterval(async () => {
      try {
        const s = await apiGet<State>(`${base}/state`);
        if (s.blocked) setNote(`${platformName} is blocking this browser. Try again later or contact support.`);
        else if (s.captcha) setNote("Please complete the verification shown in the window.");
        else setNote(null);
        if (s.loggedIn && phaseRef.current === "login") {
          setPhase("finishing");
          doneAt.current = Date.now();
          await apiPost(`${base}/finish`);
          setPhase("done");
          onConnected();
        }
      } catch (e) {
        if (phaseRef.current === "finishing") { setPhase("error"); setNote(e instanceof ApiError ? e.message : "Could not finish connecting"); }
      }
    }, 2000);
    return () => clearInterval(t);
  }, [base, phase, platformName, onConnected]);

  // Blinkit Ads emails a one-time sign-in link: it is opened inside the secure window.
  async function openLink() {
    setLinkBusy(true); setNote(null);
    try {
      const r = await apiPost<{ loggedIn: boolean }>(`${base}/link`, { url: link.trim() });
      setLink("");
      if (!r.loggedIn) setNote("The link opened but Blinkit did not log in. It may be expired or already used: request a new link in the window and paste the newest one.");
    } catch (e) { setNote(e instanceof ApiError ? e.message : "Could not open the link"); }
    finally { setLinkBusy(false); }
  }

  function close() {
    if (phase !== "done") apiPost(`${base}/stop`).catch(() => undefined);
    onClose();
  }

  function click(e: React.MouseEvent<HTMLImageElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    send({ type: "click", x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H });
    boxRef.current?.focus();
  }

  function flushTyped() {
    const text = typed.current;
    typed.current = "";
    if (text) send({ type: "type", text });
  }

  function keyDown(e: React.KeyboardEvent) {
    if (phase !== "login") return;
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      typed.current += e.key;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flushTyped, 120);
    } else if (SPECIAL_KEYS.has(e.key)) {
      e.preventDefault();
      flushTyped();
      send({ type: "key", key: e.key });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.55)" }} role="dialog" aria-modal="true">
      <div className="w-full max-w-[1000px] rounded-card border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-3 flex items-center gap-3">
          <div className="mr-auto">
            <h2 className="font-semibold">{phase === "done" ? `${platformName} connected · syncing your data` : `Connect ${platformName}`}</h2>
            {phase === "done" ? (
              <p className="text-xs" style={{ color: "var(--muted)" }}>{magicLink ? "QCP is pulling your ad account, every campaign, a year of daily performance and 30 days of keyword reports." : "QCP is pulling every sales report Blinkit offers plus your product list."} You can close this window; the sync keeps running in the background.</p>
            ) : magicLink ? <p className="text-xs" style={{ color: "var(--muted)" }}>
              1. In the window below click <b>Log In</b>, type your Blinkit Ads email and press <b>Request Sign in Link</b>. 2. Open the Blinkit email, right-click the sign-in button and copy the link. 3. Paste it in the box below. The link is used once and never stored; only the logged-in session is kept so QCP can pull your ad data on &quot;Sync now&quot;.
            </p> : <p className="text-xs" style={{ color: "var(--muted)" }}>
              Log in below with your {platformName} seller email or phone and the OTP you receive. Google sign-in does not work in this window. Click into the window and type normally.
              Your password and OTP are never stored. Only the logged-in session is kept, so QCP can pull your reports when you press "Sync now".
            </p>}
          </div>
          <button onClick={close} aria-label="Close"><X size={18} /></button>
        </div>
        {magicLink && phase === "login" && (
          <div className="mb-2 flex gap-2">
            <input className="min-w-0 flex-1 rounded-[9px] border px-3 py-2 text-[13px]" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--ink)" }}
              placeholder="Paste the sign-in link from the Blinkit email" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Sign-in link" autoComplete="off" />
            <button disabled={linkBusy || !/^https:\/\//.test(link.trim())} onClick={openLink} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold" style={{ background: "var(--accent)", color: "var(--plane)" }}>
              {linkBusy && <Loader2 size={14} className="animate-spin" />}Open link
            </button>
          </div>
        )}
        {note && <p className="mb-2 rounded-lg border p-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>{note}</p>}
        {phase === "done" ? <SyncProgress connectionId={connectionId} since={doneAt.current} /> : <div ref={boxRef} tabIndex={0} onKeyDown={keyDown} onPaste={(e) => { const t = e.clipboardData.getData("text").slice(0, 200); if (t) send({ type: "type", text: t }); }}
          onWheel={(e) => send({ type: "scroll", dy: e.deltaY })}
          className="relative overflow-hidden rounded-lg border outline-none focus:ring-2" style={{ borderColor: "var(--border)", aspectRatio: `${W}/${H}`, background: "var(--surface-2)" }}>
          {frame && <img ref={imgRef} src={frame} alt={`${platformName} login window`} onClick={click} className="h-full w-full cursor-pointer select-none" draggable={false} />}
          {(phase === "starting" || phase === "finishing" || !frame) && phase !== "error" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
              <Loader2 className="animate-spin" size={16} />{phase === "finishing" ? "Logged in. Saving the connection…" : "Opening secure browser…"}
            </div>
          )}
          {phase === "error" && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm" style={{ color: "var(--crit)" }}>{note}</div>}
        </div>}
      </div>
    </div>
  );
}
