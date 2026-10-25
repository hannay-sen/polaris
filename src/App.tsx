import { useEffect, useMemo, useState } from 'react';
import { tables, reducers } from './module_bindings';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';

const APP_NAME = 'POLARIS';
const W = 800;
const H = 460;

function idHex(id: any): string {
  if (!id) return '';
  return typeof id.toHexString === 'function' ? id.toHexString() : String(id);
}

function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

// Points of a five-pointed star, for the polygon that draws a signal.
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return pts.join(' ');
}

function memberPos(hex: string) {
  return { x: 70 + hash01(hex, 1) * (W - 140), y: 90 + hash01(hex, 2) * (H - 190) };
}

const KEEPER_URL = 'http://localhost:8787/api/keeper';

type Match = { name: string; reason: string };
type KeeperResult = {
  action: 'post' | 'crisis';
  cleanedText: string;
  category: string;
  removedPersonalDetails: boolean;
  matches: Match[];
  crisisMessage: string;
};

// Calls the Creao agent through the local keeper server, which holds the API key.
async function askKeeper(body: object): Promise<KeeperResult> {
  const res = await fetch(KEEPER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('keeper unavailable');
  const r = await res.json();
  return {
    action: r.action === 'crisis' ? 'crisis' : 'post',
    cleanedText: String(r.cleanedText ?? ''),
    category: String(r.category ?? 'other'),
    removedPersonalDetails: !!r.removedPersonalDetails,
    matches: Array.isArray(r.matches) ? r.matches : [],
    crisisMessage: String(r.crisisMessage ?? ''),
  };
}

type Opp = { title: string; link: string; deadline: string; whyItFits: string };

// Asks the keeper (find_opportunities mode) and keeps only items with a real https link.
async function askOpportunities(body: object): Promise<Opp[]> {
  const res = await fetch(KEEPER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('keeper unavailable');
  const r = await res.json();
  const items: any[] = Array.isArray(r.items) ? r.items : [];
  return items
    .map(x => ({
      title: String(x?.title ?? x?.name ?? '').slice(0, 120),
      link: String(x?.link ?? x?.url ?? x?.source ?? ''),
      deadline: String(x?.deadline ?? x?.date ?? '').slice(0, 80),
      whyItFits: String(x?.whyItFits ?? x?.why ?? x?.reason ?? '').slice(0, 400),
    }))
    .filter(o => o.title && o.link.startsWith('https://'))
    .slice(0, 5);
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0b1226',
  color: '#e6edff',
  fontFamily: 'system-ui, sans-serif',
  padding: '1.25rem',
};
const card: React.CSSProperties = {
  background: '#131d3a',
  border: '1px solid #26345f',
  borderRadius: 12,
  padding: '1rem',
  marginTop: '1rem',
};
const input: React.CSSProperties = {
  padding: '0.55rem 0.7rem',
  borderRadius: 8,
  border: '1px solid #35467c',
  background: '#0b1226',
  color: '#e6edff',
  width: '100%',
  boxSizing: 'border-box',
  marginBottom: '0.5rem',
};
const btn: React.CSSProperties = {
  padding: '0.55rem 1rem',
  borderRadius: 8,
  border: '1px solid #ffd479',
  background: '#ffd479',
  color: '#1b1b1b',
  fontWeight: 600,
  cursor: 'pointer',
};
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: '#ffd479' };

// Soft twinkling stars used as the background of the welcome screen.
function StarField() {
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {Array.from({ length: 130 }).map((_, i) => {
        const bright = hash01('w' + i, 3) > 0.8;
        return (
          <circle key={i} cx={hash01('wx' + i, 1) * 1000} cy={hash01('wy' + i, 2) * 700} r={bright ? 1.8 : 0.9} fill={bright ? '#ffffff' : '#f3ecd0'} opacity={bright ? 0.95 : 0.55}>
            {bright && <animate attributeName="opacity" values="0.95;0.3;0.95" dur={`${2 + hash01('wd' + i, 4) * 3}s`} repeatCount="indefinite" />}
          </circle>
        );
      })}
    </svg>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(8, 14, 40, 0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem',
  zIndex: 50,
};
const sheet: React.CSSProperties = {
  background: '#162247',
  border: '1px solid #3a4c8a',
  borderRadius: 16,
  padding: '1.25rem',
  width: '100%',
  maxWidth: 560,
  maxHeight: '88vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  position: 'relative',
};
const closeBtn: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 12,
  background: 'transparent',
  border: 'none',
  color: '#cfe0ff',
  fontSize: 26,
  lineHeight: 1,
  cursor: 'pointer',
};
const chip: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 999,
  padding: '0.3rem 0.8rem',
  fontSize: 13,
  color: '#e6edff',
};
const bigBtn: React.CSSProperties = { ...btn, padding: '0.85rem 1.8rem', fontSize: 17, borderRadius: 999 };
const bigBtnGhost: React.CSSProperties = { ...btnGhost, padding: '0.85rem 1.8rem', fontSize: 17, borderRadius: 999 };

function App() {
  const conn = useSpacetimeDB();
  const connected = conn.isActive;
  const myHex = idHex((conn as any).identity);

  const [members] = useTable(tables.member);
  const [signals] = useTable(tables.signal);
  const [connections] = useTable(tables.connection);
  const [opportunities] = useTable(tables.opportunity);

  const joinClub = useReducer(reducers.joinClub);
  const postSignal = useReducer(reducers.postSignal);
  const connectSignal = useReducer(reducers.connectSignal);
  const reportSignal = useReducer(reducers.reportSignal);
  const postOpportunity = useReducer(reducers.postOpportunity);

  const [jName, setJName] = useState('');
  const [jSkills, setJSkills] = useState('');
  const [jGoals, setJGoals] = useState('');
  const [jCode, setJCode] = useState('');
  const [joinTried, setJoinTried] = useState(false);
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [crisis, setCrisis] = useState('');
  const [selected, setSelected] = useState<{ kind: 'signal' | 'opp'; id: string } | null>(null);
  const [oTitle, setOTitle] = useState('');
  const [oLink, setOLink] = useState('');
  const [oDeadline, setODeadline] = useState('');
  const [oWhy, setOWhy] = useState('');
  const [interests, setInterests] = useState('');
  const [oppBusy, setOppBusy] = useState(false);
  const [oppNote, setOppNote] = useState('');
  const [oppResults, setOppResults] = useState<Opp[]>([]);
  const [view, setView] = useState<'welcome' | 'sky'>('welcome');
  const [panel, setPanel] = useState<null | 'join' | 'signal' | 'opps' | 'manual'>(null);

  const memberByHex = useMemo(() => {
    const m = new Map<string, (typeof members)[number]>();
    members.forEach(x => m.set(idHex(x.identity), x));
    return m;
  }, [members]);

  const joined = !!myHex && memberByHex.has(myHex);

  // When someone finishes joining, close the join sheet and open the sky.
  useEffect(() => {
    if (joined && panel === 'join') {
      setPanel(null);
      setView('sky');
    }
  }, [joined, panel]);

  const openPanel = (p: 'signal' | 'opps' | 'manual') => setPanel(joined ? p : 'join');
  const visible = signals.filter(s => s.status !== 'hidden');
  const signalById = new Map(visible.map(s => [String(s.id), s]));
  const openCount = visible.filter(s => s.status === 'open').length;

  const onJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!connected) return;
    setJoinTried(true);
    joinClub({ code: jCode, name: jName.trim(), skills: jSkills.trim(), goals: jGoals.trim() });
  };

  const onPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!raw.trim() || !joined || busy) return;
    const me = memberByHex.get(myHex);
    const candidates = members
      .filter(m => idHex(m.identity) !== myHex)
      .map(m => ({ name: m.name, skills: m.skills, goals: m.goals }));
    setBusy(true);
    setNote('');
    setCrisis('');
    setMatches([]);
    try {
      const r = await askKeeper({
        mode: 'match',
        member: { name: me?.name ?? '', skills: me?.skills ?? '', goals: me?.goals ?? '' },
        raw_post: raw,
        candidates,
      });
      if (r.action === 'crisis') {
        setCrisis(r.crisisMessage);
        setRaw('');
        return;
      }
      if (!r.cleanedText.trim()) throw new Error('empty');
      postSignal({ text: r.cleanedText.slice(0, 200), category: r.category });
      setMatches(r.matches.slice(0, 3));
      setNote(
        r.removedPersonalDetails
          ? 'The keeper removed personal details and posted: “' + r.cleanedText + '”'
          : 'The keeper posted: “' + r.cleanedText + '”'
      );
      setRaw('');
    } catch {
      setNote('The keeper could not run right now, so nothing was posted. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const onFindOpps = async () => {
    if (!joined || oppBusy) return;
    const me = memberByHex.get(myHex);
    setOppBusy(true);
    setOppNote('');
    setOppResults([]);
    try {
      const found = await askOpportunities({
        mode: 'find_opportunities',
        member: { name: me?.name ?? '', skills: me?.skills ?? '', goals: me?.goals ?? '' },
        interests: interests.trim() || me?.goals || me?.skills || 'coding club, internships, hackathons',
      });
      setOppResults(found);
      if (found.length === 0) setOppNote('The keeper found nothing it could verify. Try different interests.');
    } catch {
      setOppNote('The keeper could not run right now. Try again in a moment.');
    } finally {
      setOppBusy(false);
    }
  };

  const addFound = (o: Opp) => {
    postOpportunity({ title: o.title, link: o.link, deadline: o.deadline, whyItFits: o.whyItFits });
    setOppResults(prev => prev.filter(x => x.link !== o.link));
  };

  const onAddOpp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joined || !oTitle.trim() || !oLink.trim()) return;
    postOpportunity({ title: oTitle.trim(), link: oLink.trim(), deadline: oDeadline.trim(), whyItFits: oWhy.trim() });
    setOTitle('');
    setOLink('');
    setODeadline('');
    setOWhy('');
  };

  const selSignal = selected?.kind === 'signal' ? signalById.get(selected.id) : undefined;
  const selOpp = selected?.kind === 'opp' ? opportunities.find(o => String(o.id) === selected.id) : undefined;
  const selOwner = selSignal ? memberByHex.get(idHex(selSignal.owner)) : undefined;
  const isOwn = selSignal ? idHex(selSignal.owner) === myHex : false;

  const gradient = 'linear-gradient(180deg, #1c2d6e 0%, #3a4796 55%, #7a5aa6 100%)';
  const statChips = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
      <span style={chip}><strong>{members.length}</strong> members</span>
      <span style={chip}><strong>{openCount}</strong> open signals</span>
      <span style={chip}><strong>{connections.length}</strong> connections</span>
      <span style={chip}><strong>{opportunities.length}</strong> opportunities</span>
    </div>
  );

  const joinSheet = (
    <div style={backdrop} onClick={() => setPanel(null)}>
      <form onSubmit={onJoin} style={sheet} onClick={e => e.stopPropagation()}>
        <button type="button" style={closeBtn} aria-label="Close" onClick={() => setPanel(null)}>×</button>
        <h2 style={{ marginTop: 0 }}>Join the club</h2>
        <input style={input} placeholder="Your name" value={jName} onChange={e => setJName(e.target.value)} />
        <input style={input} placeholder="Skills (for example React, Python)" value={jSkills} onChange={e => setJSkills(e.target.value)} />
        <input style={input} placeholder="Goals (for example hackathons, coding challenges)" value={jGoals} onChange={e => setJGoals(e.target.value)} />
        <input style={input} placeholder="Club code" value={jCode} onChange={e => setJCode(e.target.value)} />
        <button style={btn} type="submit" disabled={!connected}>Join</button>
        {joinTried && <div style={{ color: '#ffb36b', marginTop: 8 }}>Not joined yet. Check that the club code is right.</div>}
      </form>
    </div>
  );

  if (view === 'welcome') {
    return (
      <div style={{ ...page, background: gradient, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 18 }}>
        <StarField />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
          <svg width="84" height="84" viewBox="-42 -42 84 84" aria-hidden="true">
            <circle r="34" fill="#ffd479" opacity="0.2">
              <animate attributeName="opacity" values="0.12;0.3;0.12" dur="3s" repeatCount="indefinite" />
            </circle>
            <polygon points={starPoints(0, 0, 30, 12)} fill="#ffd479" stroke="#fff3c4" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <h1 style={{ margin: 0, fontSize: 'clamp(40px, 9vw, 72px)', letterSpacing: 2 }}>{APP_NAME}</h1>
          <div style={{ fontSize: 'clamp(18px, 3.5vw, 26px)', color: '#ffe9a8' }}>Every coder needs a North Star.</div>
          <p style={{ maxWidth: 520, color: '#dbe6ff', margin: 0, lineHeight: 1.5 }}>
            A live sky where a coding club finds teammates, safely. An AI keeper cleans every post, protects personal details, and connects you with people.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
            <button style={bigBtn} onClick={() => setView('sky')}>Enter the sky</button>
            {!joined && <button style={bigBtnGhost} onClick={() => setPanel('join')}>Join the club</button>}
          </div>
          {joined && <div style={{ color: '#dbe6ff' }}>Welcome back, {memberByHex.get(myHex)?.name}.</div>}
          {statChips}
          <span style={{ color: connected ? '#9ff0c0' : '#ffb0b0', fontSize: 13 }}>{connected ? 'Connected' : 'Connecting…'}</span>
        </div>
        <p style={{ position: 'relative', color: '#c3b9e6', fontSize: 12, margin: 0 }}>
          Prototype. Not an emergency service. If you are in danger, call 911. In the US you can call or text 988.
        </p>
        {panel === 'join' && joinSheet}
      </div>
    );
  }

  return (
    <div style={{ ...page, background: gradient }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <button
          style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 24, fontWeight: 700, cursor: 'pointer', padding: 0 }}
          onClick={() => setView('welcome')}
          aria-label="Back to the welcome screen"
        >
          ✦ {APP_NAME}
        </button>
        <span style={{ color: connected ? '#9ff0c0' : '#ffb0b0', fontSize: 13 }}>{connected ? 'Connected' : 'Disconnected'}</span>
      </div>
      <div style={{ marginTop: 10 }}>{statChips}</div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', borderRadius: 12, marginTop: 12, background: '#24367a' }} role="img" aria-label="Night sky of club signals and connections">
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1c2d6e" />
            <stop offset="0.55" stopColor="#3a4796" />
            <stop offset="1" stopColor="#7a5aa6" />
          </linearGradient>
          <radialGradient id="milky" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#cdd8ff" stopOpacity="0.38" />
            <stop offset="1" stopColor="#cdd8ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#skyGrad)" />
        <ellipse cx={W * 0.55} cy={H * 0.45} rx={W * 0.55} ry={H * 0.16} fill="url(#milky)" transform={`rotate(-18 ${W * 0.55} ${H * 0.45})`} />
        {Array.from({ length: 150 }).map((_, i) => {
          const bright = hash01('b' + i, 11) > 0.82;
          return (
            <circle
              key={i}
              cx={hash01('bg' + i, 1) * W}
              cy={hash01('bg' + i, 2) * H}
              r={bright ? 1.5 + hash01('r' + i, 3) * 1.1 : 0.6 + hash01('r' + i, 3) * 0.9}
              fill={bright ? '#ffffff' : '#f3ecd0'}
              opacity={bright ? 0.95 : 0.45 + hash01('o' + i, 4) * 0.4}
            >
              {bright && <animate attributeName="opacity" values="0.95;0.4;0.95" dur={`${2 + hash01('d' + i, 12) * 3}s`} repeatCount="indefinite" />}
            </circle>
          );
        })}
        {Array.from({ length: 9 }).map((_, i) => {
          const cx = 30 + hash01('sp' + i, 1) * (W - 60);
          const cy = 20 + hash01('sp' + i, 2) * (H - 40);
          const len = 5 + hash01('sp' + i, 3) * 4;
          return (
            <g key={'sp' + i} stroke="#ffffff" strokeWidth={1} strokeLinecap="round" opacity={0.85}>
              <line x1={cx - len} y1={cy} x2={cx + len} y2={cy} />
              <line x1={cx} y1={cy - len} x2={cx} y2={cy + len} />
              <animate attributeName="opacity" values="0.9;0.3;0.9" dur={`${3 + hash01('sp' + i, 4) * 3}s`} repeatCount="indefinite" />
            </g>
          );
        })}
        {connections.map(c => {
          const s = signalById.get(String(c.signalId));
          if (!s) return null;
          const a = memberPos(idHex(s.owner));
          const b = memberPos(idHex(c.helper));
          return <line key={String(c.id)} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffd479" strokeWidth={1.5} opacity={0.7} />;
        })}
        {members.map(m => {
          const p = memberPos(idHex(m.identity));
          return (
            <g key={idHex(m.identity)}>
              <circle cx={p.x} cy={p.y} r={4} fill="#dbe6ff" stroke="#ffffff" strokeWidth={0.8} />
              <title>{m.name}</title>
            </g>
          );
        })}
        {visible.map(s => {
          const base = memberPos(idHex(s.owner));
          const ang = hash01(String(s.id), 5) * Math.PI * 2;
          const rad = 18 + hash01(String(s.id), 6) * 16;
          const x = base.x + Math.cos(ang) * rad;
          const y = base.y + Math.sin(ang) * rad;
          const open = s.status === 'open';
          const sel = selected?.kind === 'signal' && selected.id === String(s.id);
          return (
            <g key={String(s.id)} style={{ cursor: 'pointer' }} onClick={() => setSelected({ kind: 'signal', id: String(s.id) })}>
              <circle cx={x} cy={y} r={open ? 16 : 20} fill="#ffd479" opacity={0.15}>
                <animate attributeName="opacity" values="0.1;0.28;0.1" dur={`${2.5 + hash01(String(s.id), 9) * 2}s`} repeatCount="indefinite" />
              </circle>
              <polygon
                points={starPoints(x, y, open ? 11 : 13, open ? 4.6 : 5.4)}
                fill={open ? '#ffd479' : '#fff6cc'}
                stroke={open ? '#ffe9a8' : '#ffffff'}
                strokeWidth={0.8}
                strokeLinejoin="round"
              />
              {sel && <circle cx={x} cy={y} r={17} fill="none" stroke="#ffffff" strokeWidth={1.5} />}
              <title>{s.text}</title>
            </g>
          );
        })}
        {opportunities.map(o => {
          const x = 60 + hash01(String(o.id), 7) * (W - 120);
          const y = 24 + hash01(String(o.id), 8) * 34;
          const sel = selected?.kind === 'opp' && selected.id === String(o.id);
          return (
            <g key={String(o.id)} style={{ cursor: 'pointer' }} onClick={() => setSelected({ kind: 'opp', id: String(o.id) })}>
              <polygon points={`${x},${y - 9} ${x + 7},${y} ${x},${y + 9} ${x - 7},${y}`} fill="#7fd3c0" />
              {sel && <circle cx={x} cy={y} r={14} fill="none" stroke="#ffffff" strokeWidth={1.5} />}
              <title>{o.title}</title>
            </g>
          );
        })}
      </svg>
      <div style={{ color: '#dbe6ff', fontSize: 13, marginTop: 6, textAlign: 'center' }}>
        Gold stars are signals. Teal diamonds are verified opportunities. Small dots are members. Tap a star to read it.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 14 }}>
        <button style={bigBtn} onClick={() => openPanel('signal')}>✦ Send a signal</button>
        <button style={bigBtnGhost} onClick={() => openPanel('opps')}>◆ Find opportunities</button>
        <button style={bigBtnGhost} onClick={() => openPanel('manual')}>+ Add one by hand</button>
        {!joined && <button style={bigBtnGhost} onClick={() => setPanel('join')}>Join the club</button>}
      </div>

      {(selSignal || selOpp) && (
        <div style={{ ...card, position: 'relative', background: '#162247' }}>
          <button style={closeBtn} aria-label="Close" onClick={() => setSelected(null)}>×</button>
          {selSignal && (
            <>
              <div style={{ fontSize: 16, paddingRight: 24 }}>“{selSignal.text}”</div>
              <div style={{ color: '#b9c8ee', fontSize: 13, margin: '4px 0 10px' }}>
                {selSignal.category} · from {selOwner?.name ?? 'a member'} · {selSignal.status === 'open' ? 'still open' : 'answered'}
              </div>
              <button
                style={{ ...btn, opacity: joined && selSignal.status === 'open' && !isOwn ? 1 : 0.4 }}
                disabled={!joined || selSignal.status !== 'open' || isOwn}
                onClick={() => connectSignal({ signalId: selSignal.id })}
              >
                Answer this signal
              </button>{' '}
              <button style={btnGhost} disabled={!joined} onClick={() => reportSignal({ signalId: selSignal.id })}>
                Report
              </button>
            </>
          )}
          {selOpp && (
            <>
              <div style={{ fontSize: 16, paddingRight: 24 }}>{selOpp.title}</div>
              <div style={{ color: '#b9c8ee', fontSize: 13, margin: '4px 0' }}>{selOpp.deadline}</div>
              <div style={{ margin: '4px 0 8px' }}>{selOpp.whyItFits}</div>
              {selOpp.link.startsWith('https://') && (
                <a href={selOpp.link} target="_blank" rel="noopener noreferrer" style={{ color: '#7fd3c0' }}>
                  Open the source link
                </a>
              )}
            </>
          )}
        </div>
      )}

      <p style={{ color: '#c3b9e6', fontSize: 12, marginTop: 24, textAlign: 'center' }}>
        Prototype. Not an emergency service. If you are in danger, call 911. In the US you can call or text 988.
      </p>

      {panel === 'join' && joinSheet}

      {panel === 'signal' && (
        <div style={backdrop} onClick={() => setPanel(null)}>
          <form onSubmit={onPost} style={sheet} onClick={e => e.stopPropagation()}>
            <button type="button" style={closeBtn} aria-label="Close" onClick={() => setPanel(null)}>×</button>
            <h2 style={{ marginTop: 0 }}>Send a signal</h2>
            <textarea
              style={{ ...input, minHeight: 90 }}
              placeholder="Write it like you’d text a friend. The keeper cleans it up and removes personal details."
              value={raw}
              onChange={e => setRaw(e.target.value)}
            />
            <button style={btn} type="submit" disabled={busy}>{busy ? 'The keeper is writing your signal…' : 'Send to the keeper'}</button>
            <div style={{ color: '#b9c8ee', fontSize: 12, marginTop: 8 }}>
              A Creao agent running on Claude cleans your post, removes personal details, and suggests teammates. It takes about 30 seconds.
            </div>
            {note && <div style={{ color: '#e6edff', marginTop: 10 }}>{note}</div>}
            {matches.length > 0 && (
              <div style={{ marginTop: 8, color: '#e6edff' }}>
                <div style={{ fontSize: 13, color: '#b9c8ee' }}>Suggested teammates (you decide whether to reach out):</div>
                {matches.map((m, i) => (
                  <div key={i} style={{ marginTop: 4 }}><strong>{m.name}</strong>: {m.reason}</div>
                ))}
              </div>
            )}
            {crisis && <div style={{ background: '#2a1f3d', border: '1px solid #8f7bd6', borderRadius: 10, padding: 12, marginTop: 10 }}>{crisis}</div>}
            {note && !busy && (
              <div style={{ marginTop: 12 }}>
                <button type="button" style={btnGhost} onClick={() => setPanel(null)}>Back to the sky</button>
              </div>
            )}
          </form>
        </div>
      )}

      {panel === 'opps' && (
        <div style={backdrop} onClick={() => setPanel(null)}>
          <div style={sheet} onClick={e => e.stopPropagation()}>
            <button type="button" style={closeBtn} aria-label="Close" onClick={() => setPanel(null)}>×</button>
            <h2 style={{ marginTop: 0 }}>Find opportunities</h2>
            <input
              style={input}
              placeholder="What are you looking for? (e.g. summer internships, hackathons)"
              value={interests}
              onChange={e => setInterests(e.target.value)}
            />
            <button style={btn} type="button" onClick={onFindOpps} disabled={oppBusy}>
              {oppBusy ? 'The keeper is searching and checking links…' : 'Ask the keeper'}
            </button>
            <div style={{ color: '#b9c8ee', fontSize: 12, marginTop: 8 }}>
              The keeper searches, checks the links and deadlines, and suggests. You approve each one before it goes on the sky. It can take a minute.
            </div>
            {oppNote && <div style={{ color: '#e6edff', marginTop: 8 }}>{oppNote}</div>}
            {oppResults.map(o => (
              <div key={o.link} style={{ marginTop: 10, padding: 10, border: '1px solid #3a4c8a', borderRadius: 10 }}>
                <strong>{o.title}</strong>
                <div style={{ color: '#b9c8ee', fontSize: 13 }}>{o.deadline}</div>
                <div style={{ marginTop: 4 }}>{o.whyItFits}</div>
                <a href={o.link} target="_blank" rel="noreferrer noopener" style={{ color: '#6fd3c8', fontSize: 13 }}>Check the source</a>
                <div style={{ marginTop: 8 }}>
                  <button style={btn} type="button" onClick={() => addFound(o)}>Add to the sky</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel === 'manual' && (
        <div style={backdrop} onClick={() => setPanel(null)}>
          <form onSubmit={e => { onAddOpp(e); setPanel(null); }} style={sheet} onClick={e => e.stopPropagation()}>
            <button type="button" style={closeBtn} aria-label="Close" onClick={() => setPanel(null)}>×</button>
            <h2 style={{ marginTop: 0 }}>Add an opportunity</h2>
            <input style={input} placeholder="Title" value={oTitle} onChange={e => setOTitle(e.target.value)} />
            <input style={input} placeholder="Source link (https://...)" value={oLink} onChange={e => setOLink(e.target.value)} />
            <input style={input} placeholder="Date or deadline" value={oDeadline} onChange={e => setODeadline(e.target.value)} />
            <input style={input} placeholder="Why it fits" value={oWhy} onChange={e => setOWhy(e.target.value)} />
            <button style={btn} type="submit">Add</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
