let sql = null;
let ready = false;

export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('DATABASE_URL not set; persistence disabled.');
    return false;
  }

  try {
    const postgres = (await import('postgres')).default;
    sql = postgres(url, { max: 3 });
    await sql`select 1 as ok`;

    await sql`
      create table if not exists rooms (
        id text primary key,
        name text not null,
        host_key text,
        status text not null default 'active',
        current_players integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `;

    await sql`
      create table if not exists matches (
        id bigserial primary key,
        room_id text not null,
        room_name text not null,
        host_key text,
        duration_seconds integer not null default 300,
        status text not null default 'waiting',
        red_score integer not null default 0,
        blue_score integer not null default 0,
        started_at timestamptz,
        stopped_at timestamptz,
        created_at timestamptz not null default now()
      )
    `;

    ready = true;
    console.log('✅ Postgres persistence enabled and tables are ready.');
    return true;
  } catch (error) {
    ready = false;
    console.error('❌ Postgres persistence disabled after init error:', error.message);
    return false;
  }
}

export function isDbReady() {
  return ready && Boolean(sql);
}

function enabled() {
  return isDbReady();
}

export async function saveRoom(room, hostKey = '') {
  if (!enabled()) return false;
  try {
    await sql`
      insert into rooms (id, name, host_key, status, current_players, updated_at)
      values (${room.id}, ${room.name}, ${hostKey}, ${room.status || 'active'}, ${Object.keys(room.state.players).length}, now())
      on conflict (id) do update set
        name = excluded.name,
        host_key = coalesce(rooms.host_key, excluded.host_key),
        status = excluded.status,
        current_players = excluded.current_players,
        updated_at = now()
    `;
    console.log(`✅ Saved room ${room.id} to Postgres.`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to save room ${room.id}:`, error.message);
    return false;
  }
}

export async function updateRoomPlayers(room) {
  if (!enabled()) return false;
  try {
    await sql`
      update rooms
      set current_players = ${Object.keys(room.state.players).length}, status = ${room.status || room.state.status || 'active'}, updated_at = now()
      where id = ${room.id}
    `;
    return true;
  } catch (error) {
    console.error(`❌ Failed to update room ${room.id}:`, error.message);
    return false;
  }
}

export async function closeRoomRecord(room) {
  if (!enabled()) return false;
  try {
    await sql`
      update rooms
      set status = 'closed', current_players = 0, updated_at = now()
      where id = ${room.id}
    `;
    return true;
  } catch (error) {
    console.error(`❌ Failed to close room ${room.id}:`, error.message);
    return false;
  }
}

export async function startMatchRecord(room) {
  if (!enabled()) return null;
  try {
    await saveRoom(room, room.hostKey || '');
    const rows = await sql`
      insert into matches (room_id, room_name, host_key, duration_seconds, status, red_score, blue_score, started_at)
      values (${room.id}, ${room.name}, ${room.hostKey || ''}, ${room.state.limit}, 'running', ${room.state.red}, ${room.state.blue}, now())
      returning id
    `;
    console.log(`✅ Started match ${rows[0]?.id || ''} for room ${room.id}.`);
    return rows[0]?.id || null;
  } catch (error) {
    console.error(`❌ Failed to start match for room ${room.id}:`, error.message);
    return null;
  }
}

export async function finishMatchRecord(room, status = 'stopped') {
  if (!enabled()) return false;
  try {
    await saveRoom(room, room.hostKey || '');
    if (room.matchId) {
      await sql`
        update matches
        set status = ${status}, red_score = ${room.state.red}, blue_score = ${room.state.blue}, stopped_at = now()
        where id = ${room.matchId}
      `;
      console.log(`✅ Saved final score for match ${room.matchId}: red ${room.state.red}, blue ${room.state.blue}.`);
      return true;
    }

    const rows = await sql`
      insert into matches (room_id, room_name, host_key, duration_seconds, status, red_score, blue_score, started_at, stopped_at)
      values (${room.id}, ${room.name}, ${room.hostKey || ''}, ${room.state.limit}, ${status}, ${room.state.red}, ${room.state.blue}, now(), now())
      returning id
    `;
    room.matchId = rows[0]?.id || null;
    console.log(`✅ Saved final score as new match ${room.matchId || ''}: red ${room.state.red}, blue ${room.state.blue}.`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to finish match for room ${room.id}:`, error.message);
    return false;
  }
}
