/* net.js — tiny Supabase REST client for the Gunslingers daily social backend.
   The anon key is public by design (row-level security gates everything).
   Everything degrades gracefully: if the network is unreachable, the game
   falls back to the client-only daily + link-shared ghosts. */
(function (global) {
  'use strict';
  var URL = 'https://dfhzjyhafgbohsbdikkl.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmaHpqeWhhZmdib2hzYmRpa2tsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4Mzc3NzEsImV4cCI6MjA5NzQxMzc3MX0.b7z_ovUH3y8am2NcPsQkBV79GMYvAe0f4IFK2sXByxo';
  var H = { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'Content-Type': 'application/json' };
  function rest(path, opts) {
    opts = opts || {}; opts.headers = H;
    return fetch(URL + '/rest/v1/' + path, opts).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(r.status + ' ' + t); });
      return r.status === 204 ? null : r.json();
    });
  }
  function rpc(fn, body) { return rest('rpc/' + fn, { method: 'POST', body: JSON.stringify(body || {}) }); }
  function todayKey() { return new Date().toISOString().slice(0, 10); }   // UTC YYYY-MM-DD, shared boundary for all players

  var PGNet = {
    enabled: true,
    url: URL,
    todayKey: todayKey,
    // the published daily for a date (owner-set), or null
    fetchDaily: function (day) {
      return rest('daily?day=eq.' + (day || todayKey()) + '&select=day,title,hole_index,hole_json&limit=1')
        .then(function (rows) { return rows && rows[0] ? rows[0] : null; }).catch(function () { return null; });
    },
    // submit a finished run via the anti-cheat RPC (validates the ghost decodes + its shot-count == strokes).
    // resolves true on success, false on failure — so the UI can tell the player the truth (and offer a retry).
    submitRun: function (day, name, strokes, par, ghost) {
      return rpc('submit_run', { p_day: day, p_name: (name || 'Anon').slice(0, 24), p_strokes: strokes, p_par: par, p_ghost: ghost || null }).then(function () { return true; }, function () { return false; });
    },
    // recent runs with a ghost for a day (to race), best strokes first
    fetchGhosts: function (day, limit) {
      return rest('runs?day=eq.' + (day || todayKey()) + '&ghost=not.is.null&select=name,strokes,ghost&order=strokes.asc,created_at.asc&limit=' + (limit || 8))
        .catch(function () { return []; });
    },
    // best run per player for a day
    leaderboard: function (day, limit) { return rpc('leaderboard', { p_day: day || todayKey(), p_limit: limit || 20 }).catch(function () { return []; }); },
    playerCount: function (day) {
      return rest('runs?day=eq.' + (day || todayKey()) + '&select=id', { headers: H, method: 'HEAD' }) // count via header
        .catch(function () { return null; });
    },
    // ---- owner (passcode-gated) ----
    publishDaily: function (pass, day, title, holeIndex, holeJson) { return rpc('publish_daily', { p_pass: pass, p_day: day, p_title: title, p_hole_index: holeIndex == null ? null : holeIndex, p_hole_json: holeJson || null }); },
    unpublishDaily: function (pass, day) { return rpc('unpublish_daily', { p_pass: pass, p_day: day }); },
    saveBank: function (pass, title, holeIndex, holeJson, forDay) { return rpc('save_bank', { p_pass: pass, p_title: title, p_hole_index: holeIndex == null ? null : holeIndex, p_hole_json: holeJson || null, p_for_day: forDay || null }); },
    deleteBank: function (pass, id) { return rpc('delete_bank', { p_pass: pass, p_id: id }); },
    fetchBank: function () { return rest('bank?select=id,title,hole_index,hole_json,for_day,status,created_at&order=created_at.desc').catch(function () { return []; }); },
    fetchSchedule: function () { return rest('daily?select=day,title,hole_index&order=day.desc&limit=40').catch(function () { return []; }); },
    standing: function (day, name) { return rpc('daily_standing', { p_day: day || todayKey(), p_name: name }).then(function (r) { return r && r[0] ? r[0] : null; }).catch(function () { return null; }); },
    daySummary: function (day) { return rpc('day_summary', { p_day: day || todayKey() }).then(function (r) { return r && r[0] ? r[0] : null; }).catch(function () { return null; }); },
    // ---- teams (team-vs-team daily competition) ----
    createTeam: function (name) { return rpc('create_team', { p_name: name }).then(function (r) { return r && r[0] ? r[0] : null; }, function () { return null; }); },
    joinTeam: function (code, player) { return rpc('join_team', { p_code: code, p_player: player }).then(function (r) { return r && r[0] ? r[0] : null; }, function () { return null; }); },
    teamStanding: function (day) { return rpc('team_standing', { p_day: day || todayKey() }).catch(function () { return []; }); }
  };
  global.PGNet = PGNet;
})(typeof window !== 'undefined' ? window : this);
