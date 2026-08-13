// ============================================================
//  WC2026 — Scoring Engine (runs client-side + mirrors Edge Fn)
// ============================================================

const ScoringEngine = {

  // ---- Round 1: Pre-tournament questions ----
  calculateRound1(predictions, answers) {
    let points = 0;
    const breakdown = {};

    // 1.1 Tournament winner (20pts correct, 10pts if picked runner-up)
    if (predictions['1.1'] && answers['1.1']) {
      if (predictions['1.1'] === answers['1.1']) {
        points += 20; breakdown['1.1'] = 20;
      } else if (predictions['1.1'] === answers['1.2']) {
        points += 10; breakdown['1.1'] = 10;
      } else { breakdown['1.1'] = 0; }
    }

    // 1.2 Runner-up (10pts correct, 5pts if team won)
    if (predictions['1.2'] && answers['1.2']) {
      if (predictions['1.2'] === answers['1.2']) {
        points += 10; breakdown['1.2'] = 10;
      } else if (predictions['1.2'] === answers['1.1']) {
        points += 5; breakdown['1.2'] = 5;
      } else { breakdown['1.2'] = 0; }
    }

    // 1.3 Beaten semi-finalists (10pts each correct, 5pts if reached final)
    if (predictions['1.3a'] && answers['1.3']) {
      const correctSemis = answers['1.3'] || [];
      // Finalists are known once both semis finish, before the Final itself is played —
      // answers['1.1']/['1.2'] (winner/runner-up) are a superset once the Final is decided.
      const finalists = answers['1.1'] || answers['1.2']
        ? [answers['1.1'], answers['1.2']]
        : (answers['_finalists'] || []);
      ['1.3a', '1.3b'].forEach(key => {
        const pick = predictions[key];
        if (pick) {
          if (correctSemis.includes(pick)) {
            points += 10; breakdown[key] = 10;
          } else if (finalists.includes(pick)) {
            points += 5; breakdown[key] = 5;
          } else { breakdown[key] = 0; }
        }
      });
    }

    // 1.4 Top scorer name (10pts)
    if (predictions['1.4'] && answers['1.4']) {
      const scored = predictions['1.4'].trim().toLowerCase() === answers['1.4'].trim().toLowerCase();
      points += scored ? 10 : 0;
      breakdown['1.4'] = scored ? 10 : 0;
    }

    // 1.5 Top scorer goals exact (10pts)
    if (predictions['1.5'] != null && answers['1.5'] != null) {
      const scored = parseInt(predictions['1.5']) === parseInt(answers['1.5']);
      points += scored ? 10 : 0;
      breakdown['1.5'] = scored ? 10 : 0;
    }

    // 1.6 Golden boot winner (10pts)
    if (predictions['1.6'] && answers['1.6']) {
      const scored = predictions['1.6'].trim().toLowerCase() === answers['1.6'].trim().toLowerCase();
      points += scored ? 10 : 0;
      breakdown['1.6'] = scored ? 10 : 0;
    }

    // 1.7 Golden boot goals (10pts)
    if (predictions['1.7'] != null && answers['1.7'] != null) {
      const scored = parseInt(predictions['1.7']) === parseInt(answers['1.7']);
      points += scored ? 10 : 0;
      breakdown['1.7'] = scored ? 10 : 0;
    }

    // 1.8 Host nations group stage goals (5pts exact, 3pts within 3)
    if (predictions['1.8'] != null && answers['1.8'] != null) {
      const diff = Math.abs(parseInt(predictions['1.8']) - parseInt(answers['1.8']));
      if (diff === 0) { points += 5; breakdown['1.8'] = 5; }
      else if (diff <= 3) { points += 3; breakdown['1.8'] = 3; }
      else { breakdown['1.8'] = 0; }
    }

    // 1.9 Most goals in group stage from {ENG, FRA, BRA, ARG} (5pts)
    if (predictions['1.9'] && answers['1.9']) {
      const scored = predictions['1.9'] === answers['1.9'];
      points += scored ? 5 : 0;
      breakdown['1.9'] = scored ? 5 : 0;
    }

    // 1.10 Red cards in group stage (5pts exact)
    if (predictions['1.10'] != null && answers['1.10'] != null) {
      const scored = parseInt(predictions['1.10']) === parseInt(answers['1.10']);
      points += scored ? 5 : 0;
      breakdown['1.10'] = scored ? 5 : 0;
    }

    // 1.11 Total goals group stage (10pts exact, 5pts within 10)
    if (predictions['1.11'] != null && answers['1.11'] != null) {
      const diff = Math.abs(parseInt(predictions['1.11']) - parseInt(answers['1.11']));
      if (diff === 0) { points += 10; breakdown['1.11'] = 10; }
      else if (diff <= 10) { points += 5; breakdown['1.11'] = 5; }
      else { breakdown['1.11'] = 0; }
    }

    // 1.12 Hardest group (5pts: predicted group matches the actual hardest group)
    // "Hardest" = smallest points gap between 1st and 4th place.
    // Tiebreak: higher GD of the 4th-place team; further tie: group letter (A before B etc.)
    if (predictions['1.12'] && answers['1.12']) {
      const scored = predictions['1.12'] === answers['1.12'];
      points += scored ? 5 : 0;
      breakdown['1.12'] = scored ? 5 : 0;
    }

    return { points, breakdown };
  },

  // ---- Round 2: Group Winners & Runners-Up ----
  calculateRound2(predictions, answers) {
    let points = 0;
    const breakdown = {};
    const groups = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    let correctWinners = 0;
    let correctQualifiers = 0;

    groups.forEach(g => {
      const winnerKey = `2.w.${g}`;
      const runnerKey = `2.r.${g}`;

      const predictedWinner = predictions[winnerKey];
      const predictedRunner = predictions[runnerKey];
      const actualWinner = answers[winnerKey];
      const actualRunner = answers[runnerKey];

      if (predictedWinner && actualWinner) {
        if (predictedWinner === actualWinner) {
          points += 10; breakdown[winnerKey] = 10; correctWinners++;
        } else if (predictedWinner === actualRunner) {
          points += 5; breakdown[winnerKey] = 5;
        } else { breakdown[winnerKey] = 0; }
      }

      if (predictedRunner && actualRunner) {
        if (predictedRunner === actualRunner) {
          points += 10; breakdown[runnerKey] = 10;
        } else if (predictedRunner === actualWinner) {
          points += 5; breakdown[runnerKey] = 5;
        } else { breakdown[runnerKey] = 0; }
      }

      // Count correct qualifiers for bonus
      if (predictedWinner && (predictedWinner === actualWinner || predictedWinner === actualRunner)) correctQualifiers++;
      if (predictedRunner && (predictedRunner === actualRunner || predictedRunner === actualWinner)) correctQualifiers++;
    });

    // Bonus: all 12 group winners correct
    if (correctWinners === 12) { points += 10; breakdown['bonus_winners'] = 10; }
    else if (correctWinners >= 10) { points += 5; breakdown['bonus_winners'] = 5; }

    // Bonus: qualifiers
    if (correctQualifiers >= 24) { points += 10; breakdown['bonus_qualifiers'] = 10; }
    else if (correctQualifiers >= 20) { points += 5; breakdown['bonus_qualifiers'] = 5; }

    return { points, breakdown };
  },

  // ---- Rounds 3-7: Score predictions (group stage + knockouts) ----
  calculateScoreRound(predictions, answers, round) {
    let points = 0;
    const breakdown = {};
    const isFinale = round === 'round8';
    const exactPts = isFinale ? 10 : 7;
    const resultPts = isFinale ? 7 : 5;

    Object.keys(predictions).forEach(matchKey => {
      const pred = predictions[matchKey];
      const actual = answers[matchKey];
      if (!pred || !actual) return;

      const predHome = parseInt(pred.home);
      const predAway = parseInt(pred.away);
      const actHome = parseInt(actual.home);
      const actAway = parseInt(actual.away);

      if (isNaN(predHome) || isNaN(predAway) || isNaN(actHome) || isNaN(actAway)) return;

      if (predHome === actHome && predAway === actAway) {
        points += exactPts; breakdown[matchKey] = exactPts;
      } else {
        const predResult = Math.sign(predHome - predAway);
        const actResult = Math.sign(actHome - actAway);
        if (predResult === actResult) {
          points += resultPts; breakdown[matchKey] = resultPts;
        } else { breakdown[matchKey] = 0; }
      }
    });

    return { points, breakdown };
  },

  // ---- Main entry: calculate total for a user ----
  calculateTotal(allPredictions, allAnswers) {
    const totals = {
      round1: 0, round2: 0, round3: 0, round4: 0,
      round5: 0, round6: 0, round7: 0, round8: 0,
      total: 0
    };

    if (allAnswers.round1) {
      const r = this.calculateRound1(allPredictions.round1 || {}, allAnswers.round1);
      totals.round1 = r.points;
    }
    if (allAnswers.round2) {
      const r = this.calculateRound2(allPredictions.round2 || {}, allAnswers.round2);
      totals.round2 = r.points;
    }
    ['round3','round4','round5','round6','round7','round8'].forEach(round => {
      if (allAnswers[round]) {
        const r = this.calculateScoreRound(allPredictions[round] || {}, allAnswers[round], round);
        totals[round] = r.points;
      }
    });

    totals.total = Object.values(totals).reduce((a, b) => a + b, 0) - totals.total;
    return totals;
  }
};

window.ScoringEngine = ScoringEngine;

// ---- Predicted group standings ----
// predMap: { 'm73': {home:N, away:N} } — only predicted matches; blank/NaN entries skipped.
// Returns sorted rows identical to the official standings sort (Pts → GD → GF).
function computePredGroup(groupKey, predMap) {
  const stats = {};
  GROUPS[groupKey].teams.forEach(code => {
    stats[code] = { code, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
  });

  GROUP_FIXTURES
    .filter(f => f[3] === groupKey)
    .forEach(f => {
      const pred = predMap && predMap[`m${f[0]}`];
      if (!pred) return;
      const hs = parseInt(pred.home), as_ = parseInt(pred.away);
      if (isNaN(hs) || isNaN(as_)) return;
      const home = f[4], away = f[5];

      stats[home].P++; stats[away].P++;
      stats[home].GF += hs; stats[home].GA += as_;
      stats[away].GF += as_; stats[away].GA += hs;

      if (hs > as_) {
        stats[home].W++; stats[home].Pts += 3; stats[away].L++;
      } else if (hs < as_) {
        stats[away].W++; stats[away].Pts += 3; stats[home].L++;
      } else {
        stats[home].D++; stats[home].Pts++;
        stats[away].D++; stats[away].Pts++;
      }
    });

  Object.values(stats).forEach(s => { s.GD = s.GF - s.GA; });
  return Object.values(stats).sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF);
}
window.computePredGroup = computePredGroup;
