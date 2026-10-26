import React, { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
const date = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

function App() {
  const [trips, setTrips] = useState([]); const [selected, setSelected] = useState(null);
  const [logs, setLogs] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const loadTrips = useCallback(async () => {
    if (!apiBaseUrl) { setError('Set VITE_API_BASE_URL before deploying the dashboard.'); setLoading(false); return; }
    try { setLoading(true); setError(''); const response = await fetch(`${apiBaseUrl}/api/v1/trips`); if (!response.ok) throw new Error(`API returned ${response.status}.`); setTrips((await response.json()).trips); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load trips.'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadTrips(); }, [loadTrips]);
  async function openTrip(trip) { setSelected(trip); setLogs([]); try { const response = await fetch(`${apiBaseUrl}/api/v1/trips/${trip.id}/attendance`); if (!response.ok) throw new Error('Unable to load attendance.'); setLogs((await response.json()).logs); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load attendance.'); } }
  const totals = trips.reduce((sum, item) => ({ boarded: sum.boarded + item.boardedCount, completed: sum.completed + item.completedCount, incomplete: sum.incomplete + item.incompleteCount }), { boarded: 0, completed: 0, incomplete: 0 });
  return <main className="shell"><header><div><p className="eyebrow">Fleet operations</p><h1>TAPENDANCE</h1><p className="subtitle">Live trip attendance from NFC-equipped vehicle devices.</p></div><button onClick={() => void loadTrips()}>Refresh</button></header>{error && <p className="notice">{error}</p>}<section className="cards"><Card value={trips.length} label="Trips"/><Card value={totals.boarded} label="On board"/><Card value={totals.completed} label="Completed"/><Card value={totals.incomplete} label="Incomplete"/></section><section className="panel"><div className="heading"><h2>Trips</h2><span>{loading ? 'Loading…' : `${trips.length} records`}</span></div>{!loading && trips.length === 0 ? <p className="empty">No synced trips yet. Scan attendance from the Android app, then refresh.</p> : <TripTable trips={trips} openTrip={openTrip}/>}</section>{selected && <section className="panel"><div className="heading"><div><h2>{selected.routeName}</h2><span>{selected.vehicleLabel}</span></div><button className="text" onClick={() => setSelected(null)}>Close</button></div><div className="table"><table><thead><tr><th>Card</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Device</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td><code>{log.cardUid}</code></td><td><Badge value={log.status}/></td><td>{date(log.tapInTime)}</td><td>{date(log.tapOutTime)}</td><td>{log.sourceDeviceId ?? '—'}</td></tr>)}</tbody></table></div></section>}</main>;
}
const Card = ({ value, label }) => <article><strong>{value}</strong><span>{label}</span></article>;
const Badge = ({ value }) => <span className={`badge ${value.toLowerCase()}`}>{value}</span>;
function TripTable({ trips, openTrip }) { return <div className="table"><table><thead><tr><th>Route</th><th>Vehicle</th><th>Status</th><th>Started</th><th>Attendance</th><th /></tr></thead><tbody>{trips.map((trip) => <tr key={trip.id}><td><strong>{trip.routeName}</strong><small>{trip.pointAName} → {trip.pointBName}</small></td><td>{trip.vehicleLabel}</td><td><Badge value={trip.status}/></td><td>{date(trip.startedAt)}</td><td>{trip.completedCount} complete · {trip.boardedCount} onboard</td><td><button className="text" onClick={() => void openTrip(trip)}>View</button></td></tr>)}</tbody></table></div>; }
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
