'use client';

import { useState } from 'react';
import { usePrivacyWeather } from '@/hooks/useFlowData';
import { conditionToColor, conditionToEmoji } from '@/lib/privacy/scoring';
import { FlowPressure, CrowdActivity, ShieldWindow } from '@/lib/privacy/types';
import { AppLoader } from '@/components/ui/AppLoader';
import { useCanViewAdmin } from '@/store/authStore';
import { GlyphStat } from '@/lib/generative/GlyphStat';

type WeatherPeriod = '1d' | '1w' | '1m';

export function PrivacyWeather() {
  const [period, setPeriod] = useState<WeatherPeriod>('1d');
  const { weather, loading, error, refetch } = usePrivacyWeather({ period });
  const isAdmin = useCanViewAdmin();

  /*
   * Driven by net flow, which is the number this whole app is about - shielding
   * minus deshielding. A week of heavy shielding gives a rising, busy surface;
   * a quiet one barely moves.
   */
  return (
    <GlyphStat
      value={weather?.netFlow}
      accent={(weather?.netFlow ?? 0) >= 0 ? '#00cc66' : '#ff8800'}
      label="Privacy weather, net shielded flow"
    >
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="p-3 flex items-center justify-between border-b"
        style={{ borderColor: 'var(--border-window)' }}
      >
        <h2
          style={{
            color: 'var(--accent-gold)',
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--font-size-title)',
          }}
        >
          Privacy Weather
        </h2>
        <div className="flex items-center gap-2">
          {/* Period Selector */}
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as WeatherPeriod)}
            className="px-2 py-1 rounded"
            style={{
              background: 'var(--bg-window)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-window)',
              fontSize: 'var(--font-size-icon)',
            }}
          >
            <option value="1d">1 Day</option>
            <option value="1w">7 Days</option>
            <option value="1m">30 Days</option>
          </select>
          {/* Refresh Button (admin only - the system auto-updates) */}
          {isAdmin && (
            <button
              onClick={refetch}
              disabled={loading}
              className="p-1 rounded"
              style={{
                background: 'var(--bg-window)',
                border: '1px solid var(--border-window)',
                color: loading ? 'var(--text-muted)' : 'var(--text-primary)',
              }}
              title="Refresh"
            >
              <RefreshIcon spinning={loading} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div
            className="p-3 rounded mb-3"
            style={{
              background: 'rgba(255, 68, 68, 0.1)',
              border: '1px solid #ff4444',
              color: '#ff4444',
              fontSize: 'var(--font-size-icon)',
            }}
          >
            {error}
          </div>
        )}

        {loading && !weather ? (
          <div className="py-8">
            <AppLoader />
          </div>
        ) : weather ? (
          <div className="space-y-4">
            {/* Shield Window - Main Indicator */}
            <ShieldWindowCard shieldWindow={weather.shieldWindow} />

            {/* Flow Gauges */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FlowGauge
                label="INFLOW"
                pressure={weather.shieldingPressure}
                color="var(--accent-green)"
                positive
                period={period}
              />
              <FlowGauge
                label="OUTFLOW"
                pressure={weather.deshieldingPressure}
                color="#ff8800"
                positive={false}
                period={period}
              />
              <CrowdMeter crowd={weather.crowd} period={period} />
            </div>

            {/* Net Flow Summary */}
            <div
              className="p-3 rounded"
              style={{
                background: 'rgba(0, 0, 0, 0.2)',
                border: '1px solid var(--border-window)',
              }}
            >
              <div className="flex justify-between items-center">
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-muted)' }}>
                  Net Flow
                </span>
                <span
                  className="font-bold"
                  style={{
                    color: weather.netFlow >= 0 ? 'var(--accent-green)' : '#ff4444',
                    fontSize: 'var(--font-size-label)',
                  }}
                >
                  {weather.netFlow >= 0 ? '+' : ''}{formatNumber(weather.netFlow)} ZEC/{period === '1d' ? 'day' : period === '1w' ? 'week' : 'month'}
                </span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-muted)' }}>
                  Flow Ratio
                </span>
                <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-button)' }}>
                  {Math.round(weather.flowRatio * 100)}% shielding
                </span>
              </div>
            </div>

            {/* Info Box */}
            <div
              className="p-3 rounded"
              style={{
                background: 'rgba(0, 0, 0, 0.1)',
                border: '1px solid var(--border-window)',
              }}
            >
              <h4
                className="mb-2"
                style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-muted)' }}
              >
                What does this mean?
              </h4>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-muted)' }}>
                <strong>Inflow</strong> = ZEC being shielded (t→z). <strong>Outflow</strong> = ZEC being revealed (z→t).
                Higher inflow and crowd activity means better privacy conditions for shielding your funds.
              </p>
            </div>

            {/* Data Source Note */}
            <p
              className="text-center"
              style={{ color: 'var(--text-muted)', fontSize: '10px' }}
            >
              Data aggregated from public blockchain. Updated every minute.
            </p>
          </div>
        ) : null}
      </div>
    </div>
    </GlyphStat>
  );
}

// ============================================
// Shield Window Card
// ============================================

function ShieldWindowCard({ shieldWindow }: { shieldWindow: ShieldWindow }) {
  return (
    <div
      className="p-4 rounded text-center"
      style={{
        background: 'rgba(0, 0, 0, 0.2)',
        border: `2px solid ${conditionToColor(shieldWindow.condition)}`,
      }}
    >
      <div className="flex items-center justify-center gap-3 mb-2">
        <span className="text-3xl">{conditionToEmoji(shieldWindow.condition)}</span>
        <div>
          <div
            className="text-2xl font-bold"
            style={{ color: conditionToColor(shieldWindow.condition) }}
          >
            {shieldWindow.label}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-muted)' }}>
            Shield Window
          </div>
        </div>
        <span className="text-3xl">{conditionToEmoji(shieldWindow.condition)}</span>
      </div>

      {/* Score Bar */}
      <div className="relative h-3 rounded-full overflow-hidden mb-2" style={{ background: 'var(--bg-desktop)' }}>
        <div
          className="absolute h-full rounded-full transition-all duration-500"
          style={{
            width: `${shieldWindow.score}%`,
            background: conditionToColor(shieldWindow.condition),
          }}
        />
        <div
          className="absolute h-full w-1 bg-white"
          style={{ left: `${shieldWindow.score}%`, transform: 'translateX(-50%)' }}
        />
      </div>

      <div className="flex justify-between mb-2" style={{ fontSize: 'var(--font-size-muted)', color: 'var(--text-muted)' }}>
        <span>Poor</span>
        <span>Fair</span>
        <span>Good</span>
        <span>Excellent</span>
      </div>

      <div
        className="text-xl font-bold"
        style={{ color: conditionToColor(shieldWindow.condition) }}
      >
        {shieldWindow.score}/100
      </div>

      <p
        className="mt-2"
        style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-icon)' }}
      >
        {shieldWindow.reason}
      </p>
    </div>
  );
}

// ============================================
// Flow Gauge Component
// ============================================

interface FlowGaugeProps {
  label: string;
  pressure: FlowPressure;
  color: string;
  positive: boolean;
  period: WeatherPeriod;
}

function FlowGauge({ label, pressure, color, positive, period }: FlowGaugeProps) {
  const periodLabel = period === '1d' ? 'day' : period === '1w' ? 'week' : 'month';
  const trendArrow = pressure.trend === 'rising' ? '↑' : pressure.trend === 'falling' ? '↓' : '→';
  const trendColor = pressure.trend === 'rising'
    ? (positive ? 'var(--accent-green)' : '#ff4444')
    : pressure.trend === 'falling'
    ? (positive ? '#ff4444' : 'var(--accent-green)')
    : 'var(--text-muted)';

  return (
    <div
      className="p-3 rounded text-center"
      style={{
        background: 'rgba(0, 0, 0, 0.2)',
        border: '1px solid var(--border-window)',
      }}
    >
      <div
        className="mb-1 font-bold"
        style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-muted)' }}
      >
        {label}
      </div>

      {/* Mini Bar */}
      <div
        className="h-8 rounded mb-2 flex items-end justify-center overflow-hidden"
        style={{ background: 'var(--bg-desktop)' }}
      >
        <div
          className="w-full transition-all duration-500"
          style={{
            height: `${Math.min(100, (pressure.volume / 3000) * 100)}%`,
            background: color,
            opacity: 0.8,
          }}
        />
      </div>

      <div
        className="font-bold"
        style={{ color, fontSize: 'var(--font-size-button)' }}
      >
        {positive ? '+' : '-'}{formatNumber(pressure.volume)}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-muted)' }}>
        ZEC/{periodLabel}
      </div>

      <div
        className="mt-1"
        style={{ color: trendColor, fontSize: 'var(--font-size-icon)' }}
      >
        {trendArrow} {Math.abs(pressure.trendPercent)}%
      </div>
    </div>
  );
}

// ============================================
// Crowd Meter Component
// ============================================

function CrowdMeter({ crowd, period }: { crowd: CrowdActivity; period: WeatherPeriod }) {
  const periodLabel = period === '1d' ? 'day' : period === '1w' ? 'week' : 'month';
  const activityPercent = Math.min(200, crowd.activityLevel * 100);
  const activityColor = crowd.activityLevel >= 1.5
    ? 'var(--accent-green)'
    : crowd.activityLevel >= 1.0
    ? 'var(--accent-gold)'
    : '#ff8800';

  const trendArrow = crowd.trend === 'rising' ? '↑' : crowd.trend === 'falling' ? '↓' : '→';

  return (
    <div
      className="p-3 rounded text-center"
      style={{
        background: 'rgba(0, 0, 0, 0.2)',
        border: '1px solid var(--border-window)',
      }}
    >
      <div
        className="mb-1 font-bold"
        style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-muted)' }}
      >
        CROWD
      </div>

      {/* Activity Bar */}
      <div
        className="h-8 rounded mb-2 flex items-end justify-center overflow-hidden relative"
        style={{ background: 'var(--bg-desktop)' }}
      >
        <div
          className="w-full transition-all duration-500"
          style={{
            height: `${Math.min(100, activityPercent / 2)}%`,
            background: activityColor,
            opacity: 0.8,
          }}
        />
        {/* Baseline marker at 50% (1.0 activity) */}
        <div
          className="absolute w-full h-px bg-white opacity-50"
          style={{ bottom: '50%' }}
        />
      </div>

      <div
        className="font-bold"
        style={{ color: activityColor, fontSize: 'var(--font-size-button)' }}
      >
        {formatNumber(crowd.totalOps)}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-muted)' }}>
        ops/{periodLabel}
      </div>

      <div
        className="mt-1"
        style={{
          color: crowd.trend === 'rising' ? 'var(--accent-green)' : crowd.trend === 'falling' ? '#ff4444' : 'var(--text-muted)',
          fontSize: 'var(--font-size-icon)',
        }}
      >
        {trendArrow} {Math.abs(crowd.trendPercent)}%
      </div>
    </div>
  );
}

// ============================================
// Utility Components
// ============================================

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: spinning ? 'spin 1s linear infinite' : undefined,
      }}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function formatNumber(num: number): string {
  if (Math.abs(num) >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toFixed(0);
}

export default PrivacyWeather;
