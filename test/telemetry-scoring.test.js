import { expect } from 'chai';

/**
 * Copy of the Scoring Engine deviation calculation to test self-contained logic
 */
function calculateMaxLineDeviation(points) {
  if (points.length < 3) return 0;
  const start = points[0];
  const end = points[points.length - 1];

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = Math.sqrt(dx * dx + dy * dy);

  if (denominator === 0) return 0;

  let maxDeviation = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const distance = Math.abs(dy * p.x - dx * p.y + end.x * start.y - end.y * start.x) / denominator;
    if (distance > maxDeviation) {
      maxDeviation = distance;
    }
  }

  return maxDeviation;
}

/**
 * Copy of the Scoring Engine verification logic for testing
 */
function verifyTelemetryMock(telemetry, ipAddress) {
  const { mouseMoves, clicks, loadTime, clickTime, userAgent } = telemetry;

  const lowerUA = userAgent.toLowerCase();
  if (
    lowerUA.includes('headless') ||
    lowerUA.includes('puppeteer') ||
    lowerUA.includes('selenium') ||
    lowerUA.includes('playwright')
  ) {
    return { success: false, score: 10, reason: 'FRAUD_HEADLESS_BROWSER' };
  }

  const duration = clickTime - loadTime;
  if (duration < 50) {
    return { success: false, score: 5, reason: 'FRAUD_RAPID_EXECUTION' };
  }

  if (mouseMoves.length === 0) {
    return { success: false, score: 15, reason: 'FRAUD_NO_MOUSE_MOVEMENT' };
  }

  if (mouseMoves.length >= 3) {
    const deviation = calculateMaxLineDeviation(mouseMoves);
    if (deviation < 0.5) {
      return { success: false, score: 20, reason: 'FRAUD_PERFECT_STRAIGHT_LINE' };
    }
  }

  return { success: true, score: 98, reason: 'HUMAN_VERIFIED' };
}

describe('Telemetry Scoring Engine Mathematics & Logic', () => {

  it('should calculate 0 deviation for a perfectly straight diagonal line', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 }
    ];
    const deviation = calculateMaxLineDeviation(points);
    expect(deviation).to.equal(0);
  });

  it('should calculate non-zero deviation for curved trajectories', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 10 }, // Deviation here
      { x: 20, y: 20 }
    ];
    const deviation = calculateMaxLineDeviation(points);
    expect(deviation).to.be.greaterThan(0);
  });

  it('should flag clicks with zero cursor movement as bot clicks', () => {
    const data = {
      mouseMoves: [],
      clicks: [{ x: 100, y: 100, t: Date.now() }],
      keyCount: 0,
      touchCount: 0,
      screenWidth: 1920,
      screenHeight: 1080,
      loadTime: Date.now() - 500,
      clickTime: Date.now(),
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    };

    const result = verifyTelemetryMock(data, '127.0.0.1');
    expect(result.success).to.be.false;
    expect(result.score).to.equal(15);
    expect(result.reason).to.equal('FRAUD_NO_MOUSE_MOVEMENT');
  });

  it('should flag clicks with perfectly straight mouse paths as bots', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 }
    ];

    const data = {
      mouseMoves: points,
      clicks: [{ x: 30, y: 30 }],
      keyCount: 0,
      touchCount: 0,
      screenWidth: 1920,
      screenHeight: 1080,
      loadTime: Date.now() - 500,
      clickTime: Date.now(),
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    };

    const result = verifyTelemetryMock(data, '127.0.0.1');
    expect(result.success).to.be.false;
    expect(result.score).to.equal(20);
    expect(result.reason).to.equal('FRAUD_PERFECT_STRAIGHT_LINE');
  });

  it('should flag clicks executed in less than 50ms as automated bots', () => {
    const data = {
      mouseMoves: [
        { x: 100, y: 100 },
        { x: 102, y: 105 },
        { x: 110, y: 120 }
      ],
      clicks: [{ x: 110, y: 120 }],
      keyCount: 0,
      touchCount: 0,
      screenWidth: 1920,
      screenHeight: 1080,
      loadTime: Date.now() - 40,
      clickTime: Date.now(),
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    };

    const result = verifyTelemetryMock(data, '127.0.0.1');
    expect(result.success).to.be.false;
    expect(result.score).to.equal(5);
    expect(result.reason).to.equal('FRAUD_RAPID_EXECUTION');
  });

  it('should flag headless browser user agents as automated bots', () => {
    const data = {
      mouseMoves: [
        { x: 100, y: 100 },
        { x: 105, y: 112 },
        { x: 112, y: 130 }
      ],
      clicks: [{ x: 112, y: 130 }],
      keyCount: 0,
      touchCount: 0,
      screenWidth: 1920,
      screenHeight: 1080,
      loadTime: Date.now() - 500,
      clickTime: Date.now(),
      userAgent: 'Mozilla/5.0 (HeadlessChrome/114.0.0.0)'
    };

    const result = verifyTelemetryMock(data, '127.0.0.1');
    expect(result.success).to.be.false;
    expect(result.score).to.equal(10);
    expect(result.reason).to.equal('FRAUD_HEADLESS_BROWSER');
  });

  it('should pass organic human interaction curves', () => {
    const points = [
      { x: 10, y: 10 },
      { x: 12, y: 18 },
      { x: 25, y: 19 },
      { x: 40, y: 40 }
    ];

    const data = {
      mouseMoves: points,
      clicks: [{ x: 40, y: 40 }],
      keyCount: 1,
      touchCount: 0,
      screenWidth: 1920,
      screenHeight: 1080,
      loadTime: Date.now() - 800,
      clickTime: Date.now(),
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
    };

    const result = verifyTelemetryMock(data, '127.0.0.1');
    expect(result.success).to.be.true;
    expect(result.score).to.be.greaterThan(90);
    expect(result.reason).to.equal('HUMAN_VERIFIED');
  });
});
