'use client';

import { UserBadges } from '@/components/ui/UserBadges';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useSound } from '@/hooks/useSound';
import { useAuthStore } from '@/store/authStore';
import { ZecQr } from '@/components/ui/ZecQr';

// Game constants
const GAME_WIDTH = 560;
const GAME_HEIGHT = 720;
const PLAYER_SIZE = 18;
const BULLET_SIZE = 6;
const ENEMY_SIZE = 15;
const PLAYER_SPEED = 6.5;
const BULLET_SPEED = 11;
const ENEMY_SPEED = 2.6;
const POWERUP_SIZE = 17;
const POWERUP_SPEED = 2.6;

interface Entity {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

interface Enemy extends Entity {
  type: 'normal' | 'fast' | 'tank';
  hp: number;
}

interface Powerup extends Entity {
  type: 'rapid' | 'triple' | 'shield' | 'speed' | 'bomb';
}

interface LeaderboardEntry {
  name: string;
  score: number;
  date: string;
}

interface ActivePowerups {
  rapid: number;    // timestamp when expires
  triple: number;
  speed: number;
}

type GameState = 'menu' | 'playing' | 'paused' | 'gameover' | 'leaderboard';

const POWERUP_DURATION = 8000; // 8 seconds
const POWERUP_ICONS: Record<string, string> = {
  rapid: 'R',
  triple: 'T',
  shield: 'S',
  speed: '+',
  bomb: '*',
};

export function Shmup() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameLoopRef = useRef<number | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const { playClick } = useSound();

  const [gameState, setGameState] = useState<GameState>('menu');
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [playerName, setPlayerName] = useState('');
  const [showNameInput, setShowNameInput] = useState(false);

  // Tournament integration (contest engine, game='shmup')
  const { sessionToken, isVerified, isGuest } = useAuthStore();
  const authed = Boolean(sessionToken && isVerified && !isGuest);
  type CMine = { status: string; valueZEC: string; toAddress: string | null; memoText: string; zip321: string; expiresAt: number; score: number; rank: number | null } | null;
  type CT = { id: string; name: string; feeZEC: string; startAt: number; endAt: number; status: string; prizePoolZat: number; entries: { rank: number; handle: string | null; badges?: string[]; score: number }[]; myEntry: CMine };
  const [contests, setContests] = useState<CT[] | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [submitNote, setSubmitNote] = useState('');
  const fetchContests = useCallback(async () => {
    try {
      const r = await fetch('/api/contest/status?game=shmup', { headers: authed ? { Authorization: `Bearer ${sessionToken}` } : {} });
      if (r.ok) { const d = await r.json(); setContests(d.tournaments ?? []); }
    } catch { /* next */ }
  }, [authed, sessionToken]);
  useEffect(() => { fetchContests(); }, [fetchContests]);
  const enterContest = useCallback(async (id: string) => {
    if (!authed) return;
    setEnteringId(id);
    try {
      const r = await fetch('/api/contest/enter', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ tournamentId: id }) });
      if (r.ok) fetchContests();
    } catch { /* ignore */ } finally { setEnteringId(null); }
  }, [authed, sessionToken, fetchContests]);

  // Game state refs (for game loop access)
  const playerRef = useRef<Entity>({ x: GAME_WIDTH / 2, y: GAME_HEIGHT - 50 });
  const bulletsRef = useRef<Entity[]>([]);
  const enemiesRef = useRef<Enemy[]>([]);
  const powerupsRef = useRef<Powerup[]>([]);
  const scoreRef = useRef(0);
  const lastShotRef = useRef(0);
  const shieldRef = useRef(0); // shield hits remaining
  const activePowerupsRef = useRef<ActivePowerups>({ rapid: 0, triple: 0, speed: 0 });
  const comboRef = useRef(0);
  const lastKillRef = useRef(0);
  const levelRef = useRef(1);
  const frameCountRef = useRef(0);

  // Load leaderboard from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('zec-shmup-leaderboard');
    if (saved) {
      setLeaderboard(JSON.parse(saved));
    }
    const hs = localStorage.getItem('zec-shmup-highscore');
    if (hs) setHighScore(parseInt(hs, 10));
  }, []);

  const saveScore = useCallback((name: string, finalScore: number) => {
    const entry: LeaderboardEntry = {
      name: name || 'AAA',
      score: finalScore,
      date: new Date().toLocaleDateString(),
    };
    const newLeaderboard = [...leaderboard, entry]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    setLeaderboard(newLeaderboard);
    localStorage.setItem('zec-shmup-leaderboard', JSON.stringify(newLeaderboard));
    if (finalScore > highScore) {
      setHighScore(finalScore);
      localStorage.setItem('zec-shmup-highscore', String(finalScore));
    }
  }, [leaderboard, highScore]);

  const spawnEnemy = useCallback((level: number) => {
    const rand = Math.random();
    let type: Enemy['type'] = 'normal';
    let hp = 1;
    let speed = ENEMY_SPEED + Math.random() * 2;

    // Higher levels spawn harder enemies
    if (level >= 3 && rand < 0.2) {
      type = 'tank';
      hp = 3;
      speed *= 0.6;
    } else if (level >= 2 && rand < 0.4) {
      type = 'fast';
      hp = 1;
      speed *= 1.8;
    }

    // Increase base speed with level
    speed += level * 0.3;

    enemiesRef.current.push({
      x: Math.random() * (GAME_WIDTH - ENEMY_SIZE * 2) + ENEMY_SIZE,
      y: -ENEMY_SIZE,
      vx: (Math.random() - 0.5) * 2,
      vy: speed,
      type,
      hp,
    });
  }, []);

  const spawnPowerup = useCallback((x: number, y: number) => {
    // 15% chance to spawn powerup on kill
    if (Math.random() > 0.15) return;

    const types: Powerup['type'][] = ['rapid', 'triple', 'shield', 'speed', 'bomb'];
    const type = types[Math.floor(Math.random() * types.length)];

    powerupsRef.current.push({
      x,
      y,
      vy: POWERUP_SPEED,
      type,
    });
  }, []);

  const resetGame = useCallback(() => {
    playerRef.current = { x: GAME_WIDTH / 2, y: GAME_HEIGHT - 50 };
    bulletsRef.current = [];
    enemiesRef.current = [];
    powerupsRef.current = [];
    scoreRef.current = 0;
    shieldRef.current = 0;
    activePowerupsRef.current = { rapid: 0, triple: 0, speed: 0 };
    comboRef.current = 0;
    lastKillRef.current = 0;
    levelRef.current = 1;
    frameCountRef.current = 0;
    setScore(0);
  }, []);

  const startGame = useCallback(() => {
    playClick();
    resetGame();
    setGameState('playing');
  }, [playClick, resetGame]);

  const gameOver = useCallback(() => {
    setGameState('gameover');
    const final = scoreRef.current;
    setScore(final);
    if (final > 0) setShowNameInput(true);
    // Submit to any open shmup tournaments the player is entered in.
    if (authed && final > 0) {
      fetch('/api/contest/score', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ game: 'shmup', score: final }) })
        .then((r) => r.ok ? r.json() : null)
        .then(() => { const entered = (contests ?? []).filter((c) => c.status === 'open' && c.myEntry?.status === 'paid').length; if (entered > 0) setSubmitNote(`Score submitted to ${entered} tournament${entered === 1 ? '' : 's'}.`); fetchContests(); })
        .catch(() => {});
    }
  }, [authed, sessionToken, contests, fetchContests]);

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const update = () => {
      const player = playerRef.current;
      const keys = keysRef.current;
      const now = Date.now();
      const powerups = activePowerupsRef.current;

      // Update level based on score
      levelRef.current = Math.floor(scoreRef.current / 2000) + 1;

      // Check combo timeout (1.5 seconds)
      if (now - lastKillRef.current > 1500) {
        comboRef.current = 0;
      }

      // Player movement (omni-directional)
      const speed = powerups.speed > now ? PLAYER_SPEED * 1.5 : PLAYER_SPEED;
      if (keys.has('ArrowLeft') || keys.has('a')) player.x -= speed;
      if (keys.has('ArrowRight') || keys.has('d')) player.x += speed;
      if (keys.has('ArrowUp') || keys.has('w')) player.y -= speed;
      if (keys.has('ArrowDown') || keys.has('s')) player.y += speed;

      // Clamp player position
      player.x = Math.max(PLAYER_SIZE, Math.min(GAME_WIDTH - PLAYER_SIZE, player.x));
      player.y = Math.max(PLAYER_SIZE, Math.min(GAME_HEIGHT - PLAYER_SIZE, player.y));

      // Shooting (spacebar or z)
      const fireRate = powerups.rapid > now ? 80 : 150;
      if ((keys.has(' ') || keys.has('z')) && now - lastShotRef.current > fireRate) {
        if (powerups.triple > now) {
          // Triple shot
          bulletsRef.current.push({ x: player.x, y: player.y - PLAYER_SIZE });
          bulletsRef.current.push({ x: player.x - 12, y: player.y - PLAYER_SIZE + 5, vx: -1 });
          bulletsRef.current.push({ x: player.x + 12, y: player.y - PLAYER_SIZE + 5, vx: 1 });
        } else {
          bulletsRef.current.push({ x: player.x, y: player.y - PLAYER_SIZE });
        }
        lastShotRef.current = now;
      }

      // Update bullets
      bulletsRef.current = bulletsRef.current.filter(b => {
        b.y -= BULLET_SPEED;
        b.x += (b.vx || 0);
        return b.y > -BULLET_SIZE && b.x > 0 && b.x < GAME_WIDTH;
      });

      // Spawn enemies (faster spawn at higher levels)
      const spawnRate = Math.max(10, 30 - levelRef.current * 2);
      if (frameCountRef.current % spawnRate === 0) {
        spawnEnemy(levelRef.current);
      }

      // Update enemies
      enemiesRef.current = enemiesRef.current.filter(e => {
        e.x += e.vx || 0;
        e.y += e.vy || 0;

        // Bounce off walls
        if (e.x < ENEMY_SIZE || e.x > GAME_WIDTH - ENEMY_SIZE) {
          e.vx = -(e.vx || 0);
        }

        // Check collision with player
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        if (Math.sqrt(dx * dx + dy * dy) < PLAYER_SIZE + ENEMY_SIZE) {
          if (shieldRef.current > 0) {
            shieldRef.current--;
            return false; // Destroy enemy, keep player
          }
          gameOver();
          return false;
        }

        return e.y < GAME_HEIGHT + ENEMY_SIZE;
      });

      // Update powerups
      powerupsRef.current = powerupsRef.current.filter(p => {
        p.y += p.vy || POWERUP_SPEED;

        // Check collision with player
        const dx = p.x - player.x;
        const dy = p.y - player.y;
        if (Math.sqrt(dx * dx + dy * dy) < PLAYER_SIZE + POWERUP_SIZE) {
          // Collect powerup
          switch (p.type) {
            case 'rapid':
              activePowerupsRef.current.rapid = now + POWERUP_DURATION;
              break;
            case 'triple':
              activePowerupsRef.current.triple = now + POWERUP_DURATION;
              break;
            case 'speed':
              activePowerupsRef.current.speed = now + POWERUP_DURATION;
              break;
            case 'shield':
              shieldRef.current = Math.min(shieldRef.current + 1, 3);
              break;
            case 'bomb':
              // Clear all enemies and score points
              const bombScore = enemiesRef.current.length * 50;
              scoreRef.current += bombScore;
              setScore(scoreRef.current);
              enemiesRef.current = [];
              break;
          }
          return false;
        }

        return p.y < GAME_HEIGHT + POWERUP_SIZE;
      });

      // Bullet-enemy collision
      bulletsRef.current = bulletsRef.current.filter(b => {
        for (let i = enemiesRef.current.length - 1; i >= 0; i--) {
          const e = enemiesRef.current[i];
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          if (Math.sqrt(dx * dx + dy * dy) < BULLET_SIZE + ENEMY_SIZE) {
            e.hp--;
            if (e.hp <= 0) {
              // Update combo
              comboRef.current++;
              lastKillRef.current = now;

              // Score with combo multiplier
              const baseScore = e.type === 'tank' ? 300 : e.type === 'fast' ? 150 : 100;
              const comboMultiplier = Math.min(comboRef.current, 10);
              const points = baseScore * comboMultiplier;
              scoreRef.current += points;
              setScore(scoreRef.current);

              // Chance to spawn powerup
              spawnPowerup(e.x, e.y);

              enemiesRef.current.splice(i, 1);
            }
            return false;
          }
        }
        return true;
      });

      frameCountRef.current++;
    };

    const render = () => {
      const now = Date.now();
      const powerups = activePowerupsRef.current;

      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      // Draw stars background (subtle)
      ctx.fillStyle = '#1a1a2a';
      for (let i = 0; i < 20; i++) {
        const starY = ((frameCountRef.current * 0.5 + i * 50) % GAME_HEIGHT);
        ctx.fillText('.', (i * 37) % GAME_WIDTH, starY);
      }

      // Draw player (ASCII ship)
      const playerColor = shieldRef.current > 0 ? '#00ffff' : '#00ff88';
      ctx.fillStyle = playerColor;
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';

      // Shield visual
      if (shieldRef.current > 0) {
        ctx.fillText(`(${shieldRef.current})`, playerRef.current.x, playerRef.current.y - 18);
      }

      ctx.fillText('/|\\', playerRef.current.x, playerRef.current.y);
      ctx.fillText('|^|', playerRef.current.x, playerRef.current.y + 12);

      // Speed boost trail
      if (powerups.speed > now) {
        ctx.fillStyle = '#00ff8844';
        ctx.fillText('~~~', playerRef.current.x, playerRef.current.y + 24);
      }

      // Draw bullets
      ctx.fillStyle = powerups.triple > now ? '#ff00ff' : '#f4b728';
      bulletsRef.current.forEach(b => {
        ctx.fillText('|', b.x, b.y);
      });

      // Draw enemies
      enemiesRef.current.forEach(e => {
        switch (e.type) {
          case 'tank':
            ctx.fillStyle = '#ff0000';
            ctx.fillText('[#]', e.x, e.y);
            // Show HP
            if (e.hp > 1) {
              ctx.font = '10px monospace';
              ctx.fillText(String(e.hp), e.x, e.y - 10);
              ctx.font = '16px monospace';
            }
            break;
          case 'fast':
            ctx.fillStyle = '#ffff00';
            ctx.fillText('>>>', e.x, e.y);
            break;
          default:
            ctx.fillStyle = '#ff6600';
            ctx.fillText('\\V/', e.x, e.y);
        }
      });

      // Draw powerups
      powerupsRef.current.forEach(p => {
        ctx.fillStyle = p.type === 'bomb' ? '#ff0000' :
                        p.type === 'shield' ? '#00ffff' :
                        p.type === 'speed' ? '#00ff00' : '#ff00ff';
        ctx.font = '14px monospace';
        ctx.fillText(`[${POWERUP_ICONS[p.type]}]`, p.x, p.y);
      });

      // Draw HUD
      ctx.fillStyle = '#00ff88';
      ctx.font = '14px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`SCORE: ${scoreRef.current}`, 10, 20);

      // Combo display
      if (comboRef.current > 1) {
        ctx.fillStyle = '#f4b728';
        ctx.fillText(`x${Math.min(comboRef.current, 10)} COMBO`, 10, 36);
      }

      // Level display
      ctx.fillStyle = '#9966ff';
      ctx.textAlign = 'center';
      ctx.fillText(`LVL ${levelRef.current}`, GAME_WIDTH / 2, 20);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#00ff88';
      ctx.fillText(`HI: ${highScore}`, GAME_WIDTH - 10, 20);

      // Active powerups indicator
      ctx.font = '12px monospace';
      let powerupY = 36;
      if (powerups.rapid > now) {
        ctx.fillStyle = '#ff00ff';
        ctx.fillText(`RAPID ${Math.ceil((powerups.rapid - now) / 1000)}s`, GAME_WIDTH - 10, powerupY);
        powerupY += 14;
      }
      if (powerups.triple > now) {
        ctx.fillStyle = '#ff00ff';
        ctx.fillText(`TRIPLE ${Math.ceil((powerups.triple - now) / 1000)}s`, GAME_WIDTH - 10, powerupY);
        powerupY += 14;
      }
      if (powerups.speed > now) {
        ctx.fillStyle = '#00ff00';
        ctx.fillText(`SPEED ${Math.ceil((powerups.speed - now) / 1000)}s`, GAME_WIDTH - 10, powerupY);
      }
    };

    const gameLoop = () => {
      update();
      render();
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    };

    gameLoopRef.current = requestAnimationFrame(gameLoop);

    return () => {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
    };
  }, [gameState, highScore, spawnEnemy, spawnPowerup, gameOver]);

  // Key handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (e.key === 'Escape' && gameState === 'playing') {
        setGameState('paused');
      } else if (e.key === 'Escape' && gameState === 'paused') {
        setGameState('playing');
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  const handleNameSubmit = () => {
    saveScore(playerName, scoreRef.current);
    setShowNameInput(false);
    setPlayerName('');
    setGameState('leaderboard');
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#0a0a1a] p-2">
      {gameState === 'menu' && (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <pre className="text-[var(--accent-gold)] text-center" style={{ fontSize: '10px' }}>
{`
  _____ _   _ __  __ _   _ ____
 / ____| | | |  \\/  | | | |  _ \\
| (___ | |_| | \\  / | | | | |_) |
 \\___ \\|  _  | |\\/| | | | |  __/
 ____) | | | | |  | | |_| | |
|_____/|_| |_|_|  |_|\\___/|_|
`}
          </pre>
          <button onClick={startGame} className="btn-window px-6 py-2 text-[var(--text-green)]">
            START GAME
          </button>
          <button onClick={() => { playClick(); setGameState('leaderboard'); }} className="btn-window px-6 py-2 text-[var(--text-amber)]">
            LEADERBOARD
          </button>
          {/* Tournaments (contest engine) */}
          {contests && contests.filter(c => c.status !== 'closed').length > 0 && (
            <div style={{ width: '100%', maxWidth: '460px', border: '1px solid #244', padding: '8px', fontFamily: 'monospace', fontSize: '12px', color: '#DDD', maxHeight: '190px', overflowY: 'auto' }}>
              <div style={{ color: '#FFD700', marginBottom: '4px' }}>🏆 TOURNAMENTS</div>
              {!authed && <div style={{ color: '#8ab', fontSize: '11px', marginBottom: '4px' }}>Verify your account in ZEC-OS to enter ranked play.</div>}
              {contests.filter(c => c.status !== 'closed').map(c => {
                const e = c.myEntry; const now = Date.now();
                return (
                  <div key={c.id} style={{ borderTop: '1px solid #223', paddingTop: '4px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: c.status === 'open' ? '#5F5' : '#3CF' }}>{c.status === 'open' ? '● ' : '○ '}{c.name}</span>
                      <span style={{ color: '#667', fontSize: '11px' }}>{c.feeZEC} ZEC · {c.status === 'open' ? `ends ${Math.max(0, Math.ceil((c.endAt - now) / 60000))}m` : 'soon'}</span>
                    </div>
                    {authed && c.status === 'open' && (
                      e?.status === 'paid' ? <div style={{ color: '#5F5', fontSize: '11px' }}>✓ entered - best {e.score.toLocaleString()}{e.rank ? ` · #${e.rank}` : ''}</div>
                      : e?.status === 'pending' ? (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '3px' }}>
                          <div style={{ flex: 1, fontSize: '10px' }}>
                            <div style={{ color: '#667' }}>Send {e.valueZEC} ZEC · memo:</div>
                            <div style={{ color: '#3CF', wordBreak: 'break-all' }}>{e.memoText}</div>
                            <a href={e.zip321} style={{ color: '#3CF', textDecoration: 'underline' }}>▶ open in wallet</a>
                          </div>
                          <ZecQr value={e.zip321} size={70} />
                        </div>
                      ) : (
                        <button onClick={() => enterContest(c.id)} disabled={enteringId === c.id} style={{ color: '#FFD700', background: 'none', border: '1px solid #244', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', padding: '1px 6px', marginTop: '2px' }}>
                          {enteringId === c.id ? '…' : `ENTER - ${c.feeZEC} ZEC`}
                        </button>
                      )
                    )}
                    {/* mini leaderboard */}
                    {c.entries.slice(0, 3).map(r => (
                      <div key={r.rank} style={{ fontSize: '10px', color: r.rank <= 3 ? '#FFD700' : '#8ab' }}>{r.rank}. {r.handle ?? '-'}<UserBadges keys={r.badges} size={10} /> - {r.score.toLocaleString()}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-[var(--text-green)] text-xs mt-4 text-center">
            <div>WASD/Arrows: Move</div>
            <div>Space/Z: Shoot</div>
            <div>ESC: Pause</div>
          </div>
          <div className="text-[var(--text-amber)] text-xs mt-2 text-center">
            <div>POWERUPS:</div>
            <div className="text-[var(--accent-purple)]">[R]apid [T]riple [S]hield [+]Speed [*]Bomb</div>
          </div>
        </div>
      )}

      {gameState === 'playing' && (
        <canvas
          ref={canvasRef}
          width={GAME_WIDTH}
          height={GAME_HEIGHT}
          className="border border-[var(--border-window)]"
          style={{ imageRendering: 'pixelated' }}
        />
      )}

      {gameState === 'paused' && (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <div className="text-[var(--accent-gold)] text-xl">PAUSED</div>
          <button onClick={() => setGameState('playing')} className="btn-window px-6 py-2 text-[var(--text-green)]">
            RESUME
          </button>
          <button onClick={() => setGameState('menu')} className="btn-window px-6 py-2 text-[var(--text-amber)]">
            QUIT
          </button>
        </div>
      )}

      {gameState === 'gameover' && (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <div className="text-[var(--accent-orange)] text-xl">GAME OVER</div>
          <div className="text-[var(--text-green)]">Score: {score}</div>
          <div className="text-[var(--accent-purple)]">Level: {levelRef.current}</div>
          {submitNote && <div style={{ color: '#5F5', fontFamily: 'monospace', fontSize: '12px' }}>🏆 {submitNote}</div>}
          {showNameInput ? (
            <div className="flex flex-col items-center gap-2">
              <input
                type="text"
                maxLength={3}
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value.toUpperCase())}
                placeholder="AAA"
                className="bg-[var(--bg-window)] border border-[var(--border-window)] text-[var(--text-green)] px-2 py-1 text-center w-20 uppercase"
                autoFocus
              />
              <button onClick={handleNameSubmit} className="btn-window px-4 py-1 text-[var(--accent-gold)]">
                SAVE
              </button>
            </div>
          ) : (
            <>
              <button onClick={startGame} className="btn-window px-6 py-2 text-[var(--text-green)]">
                PLAY AGAIN
              </button>
              <button onClick={() => setGameState('menu')} className="btn-window px-6 py-2 text-[var(--text-amber)]">
                MENU
              </button>
            </>
          )}
        </div>
      )}

      {gameState === 'leaderboard' && (
        <div className="flex flex-col items-center h-full gap-2 p-4">
          <div className="text-[var(--accent-gold)] text-lg mb-2">LEADERBOARD</div>
          <div className="w-full max-w-xs">
            {leaderboard.length === 0 ? (
              <div className="text-[var(--text-amber)] text-center">No scores yet!</div>
            ) : (
              leaderboard.map((entry, i) => (
                <div key={i} className="flex justify-between text-[var(--text-green)] text-sm py-1 border-b border-[var(--border-window)]">
                  <span>{i + 1}. {entry.name}</span>
                  <span>{entry.score}</span>
                </div>
              ))
            )}
          </div>
          <button onClick={() => { playClick(); setGameState('menu'); }} className="btn-window px-6 py-2 text-[var(--text-amber)] mt-4">
            BACK
          </button>
        </div>
      )}
    </div>
  );
}

export default Shmup;
