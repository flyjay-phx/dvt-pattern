// 착륙 채점. 서버도 이 함수로 점수를 다시 계산한다 (브라우저가 보낸 점수는 믿지 않음).
export const AIM_POINT_FT = 1000; // 조준점: 시단에서 1,000ft

export function scoreLanding(m) {
  const notes = [];
  let score = 100;
  const sink = Math.max(0, m.sinkFpm);
  if (sink > 200) {
    const p = sink <= 600 ? ((sink - 200) / 400) * 35 : 50;
    score -= p;
    notes.push(sink > 600 ? `세게 닿음: 분당 ${Math.round(sink)}ft 하강` : `조금 세게: 분당 ${Math.round(sink)}ft (200ft 이하가 부드러움)`);
  } else notes.push(`부드러운 접지: 분당 ${Math.round(sink)}ft`);

  const half = (m.runwayWidthFt || 100) / 2;
  const cl = Math.abs(m.centerlineFt);
  if (cl > 10) {
    score -= Math.min(20, ((cl - 10) / Math.max(half - 10, 1)) * 20);
    notes.push(`중심선에서 ${Math.round(cl)}ft 벗어남`);
  }

  const x = m.fromThresholdFt;
  if (x < 500) {
    score -= Math.min(25, ((500 - x) / 500) * 25);
    notes.push(`조준점보다 짧게 닿음 (시단에서 ${Math.round(x)}ft)`);
  } else if (x > 1500) {
    score -= Math.min(20, (x - 1500) / 100);
    notes.push(`길게 닿음 (시단에서 ${Math.round(x)}ft, 조준점은 1,000ft)`);
  } else notes.push(`접지 구역 안 (시단에서 ${Math.round(x)}ft)`);

  const ias = m.iasKt;
  if (ias > 62) {
    score -= ias > 70 ? 20 : 10;
    notes.push(`접지 속도가 빠름 ${Math.round(ias)}kt (45~62kt 권장)`);
  } else if (ias < 45) {
    score -= 5;
    notes.push(`접지 속도가 실속에 가까움 ${Math.round(ias)}kt`);
  }

  if (Math.abs(m.crabDeg) > 5) {
    score -= 10;
    notes.push(`기수와 진행 방향이 ${Math.round(Math.abs(m.crabDeg))}° 어긋남 (측풍 보정 부족)`);
  }
  if (Math.abs(m.bankDeg || 0) > 6) {
    score -= 5;
    notes.push(`접지 때 날개가 ${Math.round(Math.abs(m.bankDeg))}° 기움`);
  }
  if (m.checklist) score += 3;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
  const label = { A: '아주 좋음', B: '좋음', C: '보통', D: '연습 필요' }[grade];
  return { score, grade, label, notes };
}
