import { schema, table, t, SenderError } from 'spacetimedb/server';

// Soft demo gate only. This repo is public, so anyone can read this value.
// Real access control would use SpacetimeAuth or an OIDC provider.
const CLUB_CODE = 'NORTHSTAR';

const spacetimedb = schema({
  // Template starter table. Kept so the starter page keeps working
  // until the sky view replaces it.
  person: table(
    { public: true },
    {
      name: t.string(),
    }
  ),

  // One row per club member. Only what they choose to share.
  member: table(
    { public: true },
    {
      identity: t.identity().primaryKey(),
      name: t.string(),
      skills: t.string(),
      goals: t.string(),
    }
  ),

  // A star on the sky. Text is the cleaned version from the Creao agent,
  // so raw messages with personal details are never stored.
  signal: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      owner: t.identity(),
      text: t.string(),
      category: t.string(), // teammate | challenge | study | other
      status: t.string(), // open | connected | hidden
      createdAt: t.timestamp(),
    }
  ),

  // A line between two stars when someone answers a signal.
  connection: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      signalId: t.u64(),
      helper: t.identity(),
      createdAt: t.timestamp(),
    }
  ),

  // A different colored star: a verified opportunity found by the agent.
  opportunity: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      title: t.string(),
      link: t.string(),
      deadline: t.string(),
      whyItFits: t.string(),
      postedBy: t.identity(),
      createdAt: t.timestamp(),
    }
  ),

  report: table(
    { public: true },
    {
      id: t.u64().primaryKey().autoInc(),
      signalId: t.u64(),
      reporter: t.identity(),
      createdAt: t.timestamp(),
    }
  ),
});
export default spacetimedb;

export const init = spacetimedb.init(_ctx => {
  // Called when the module is initially published
});

export const onConnect = spacetimedb.clientConnected(_ctx => {
  // Called every time a new client connects
});

export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {
  // Called every time a client disconnects
});

// Template starter reducers. Kept for now.
export const add = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    ctx.db.person.insert({ name });
  }
);

export const sayHello = spacetimedb.reducer(ctx => {
  for (const person of ctx.db.person.iter()) {
    console.info(`Hello, ${person.name}!`);
  }
  console.info('Hello, World!');
});

export const joinClub = spacetimedb.reducer(
  { code: t.string(), name: t.string(), skills: t.string(), goals: t.string() },
  (ctx, { code, name, skills, goals }) => {
    if (code !== CLUB_CODE) throw new SenderError('That club code is not right.');
    if (name.length === 0 || name.length > 60) throw new SenderError('Name must be 1 to 60 characters.');
    const existing = ctx.db.member.identity.find(ctx.sender);
    if (existing) {
      ctx.db.member.identity.update({ ...existing, name, skills, goals });
    } else {
      ctx.db.member.insert({ identity: ctx.sender, name, skills, goals });
    }
  }
);

export const postSignal = spacetimedb.reducer(
  { text: t.string(), category: t.string() },
  (ctx, { text, category }) => {
    if (!ctx.db.member.identity.find(ctx.sender)) {
      throw new SenderError('Join the club first.');
    }
    if (text.length === 0 || text.length > 200) {
      throw new SenderError('A signal must be 1 to 200 characters.');
    }
    ctx.db.signal.insert({
      id: 0n,
      owner: ctx.sender,
      text,
      category,
      status: 'open',
      createdAt: ctx.timestamp,
    });
  }
);

// Atomic: two people cannot answer the same signal at once.
export const connectSignal = spacetimedb.reducer(
  { signalId: t.u64() },
  (ctx, { signalId }) => {
    if (!ctx.db.member.identity.find(ctx.sender)) {
      throw new SenderError('Join the club first.');
    }
    const signal = ctx.db.signal.id.find(signalId);
    if (!signal) throw new SenderError('That signal is gone.');
    if (signal.status !== 'open') throw new SenderError('Someone already answered this one.');
    if (signal.owner.isEqual(ctx.sender)) throw new SenderError('You cannot answer your own signal.');
    ctx.db.signal.id.update({ ...signal, status: 'connected' });
    ctx.db.connection.insert({
      id: 0n,
      signalId,
      helper: ctx.sender,
      createdAt: ctx.timestamp,
    });
  }
);

export const postOpportunity = spacetimedb.reducer(
  { title: t.string(), link: t.string(), deadline: t.string(), whyItFits: t.string() },
  (ctx, { title, link, deadline, whyItFits }) => {
    if (!ctx.db.member.identity.find(ctx.sender)) {
      throw new SenderError('Join the club first.');
    }
    if (!link.startsWith('https://')) throw new SenderError('Link must start with https://');
    ctx.db.opportunity.insert({
      id: 0n,
      title,
      link,
      deadline,
      whyItFits,
      postedBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
  }
);

export const reportSignal = spacetimedb.reducer(
  { signalId: t.u64() },
  (ctx, { signalId }) => {
    const signal = ctx.db.signal.id.find(signalId);
    if (!signal) return;
    ctx.db.report.insert({
      id: 0n,
      signalId,
      reporter: ctx.sender,
      createdAt: ctx.timestamp,
    });
    ctx.db.signal.id.update({ ...signal, status: 'hidden' });
  }
);