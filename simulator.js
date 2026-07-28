let races = [];
let simMode = 'jockey';

const periodModeInputs = document.querySelectorAll('input[name="period-mode"]');
const periodValueInput = document.getElementById('period-value');
const betAmountInput = document.getElementById('bet-amount');
const jockeyField = document.getElementById('jockey-field');
const jockeySelect = document.getElementById('jockey-select');
const venueField = document.getElementById('venue-field');
const venueSelect = document.getElementById('venue-select');
const calcButton = document.getElementById('calc-button');
const errorBox = document.getElementById('error-box');
const resultBox = document.getElementById('result-box');
const tabButtons = document.querySelectorAll('.tab-btn');

const BET_MIN = 100;
const BET_MAX = 10000000;
const MIN_RIDES = 0; // 出走回数が1回以上(> 0)の騎手を表示
const MODE_DEFAULTS = { years: 10, races: 100, year: null };

init();

async function init() {
  const res = await fetch('data/races.json');
  races = await res.json();
  if (races.length > 0) {
    MODE_DEFAULTS.year = races[0].year;
    periodValueInput.dataset.yearMin = races[races.length - 1].year;
    periodValueInput.dataset.yearMax = races[0].year;
  }
  bindEvents();
  updateOptionsForMode();
  validate();
}

function countBy(targetRaces, keyFn) {
  const counts = new Map();
  for (const race of targetRaces) {
    const key = keyFn(race);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function countRidesByJockey(targetRaces) {
  const counts = new Map();
  for (const race of targetRaces) {
    for (const horse of race.horses) {
      if (!horse.jockey) continue;
      counts.set(horse.jockey, (counts.get(horse.jockey) || 0) + 1);
    }
  }
  return counts;
}

function updateJockeyOptions() {
  const previousSelection = jockeySelect.value;
  const targetRaces = selectTargetRaces(getPeriodMode(), Number(periodValueInput.value) || 0);
  const counts = countRidesByJockey(targetRaces);

  const eligible = Array.from(counts.entries())
    .filter(([, count]) => count > MIN_RIDES)
    .sort((a, b) => b[1] - a[1])
    .map(([jockey]) => jockey);

  jockeySelect.innerHTML = '<option value="">選択してください</option>';
  for (const jockey of eligible) {
    const option = document.createElement('option');
    option.value = jockey;
    option.textContent = `${jockey}（${counts.get(jockey)}回）`;
    jockeySelect.appendChild(option);
  }

  jockeySelect.value = eligible.includes(previousSelection) ? previousSelection : '';
}

function updateVenueOptions() {
  const previousSelection = venueSelect.value;
  const mode = getPeriodMode();
  const value = Number(periodValueInput.value) || 0;

  const allVenues = Array.from(countBy(races, (race) => race.venue).keys());
  const allCount = selectTargetRaces(mode, value).length;

  const entries = allVenues
    .map((venue) => [venue, selectTargetRaces(mode, value, venue).length])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  venueSelect.innerHTML = `<option value="">すべての開催場（${allCount}件）</option>`;
  for (const [venue, count] of entries) {
    const option = document.createElement('option');
    option.value = venue;
    option.textContent = `${venue}（${count}件）`;
    venueSelect.appendChild(option);
  }

  const stillValid = entries.some(([venue]) => venue === previousSelection);
  venueSelect.value = stillValid ? previousSelection : '';
}

function updateOptionsForMode() {
  if (simMode === 'jockey') {
    updateJockeyOptions();
  } else {
    updateVenueOptions();
  }
}

function bindEvents() {
  betAmountInput.addEventListener('input', validate);
  jockeySelect.addEventListener('change', validate);
  venueSelect.addEventListener('change', validate);
  periodValueInput.addEventListener('input', () => {
    updateOptionsForMode();
    validate();
  });
  periodModeInputs.forEach((el) => el.addEventListener('change', () => {
    const mode = getPeriodMode();
    periodValueInput.value = MODE_DEFAULTS[mode];
    if (mode === 'year') {
      periodValueInput.min = periodValueInput.dataset.yearMin;
      periodValueInput.max = periodValueInput.dataset.yearMax;
    } else {
      periodValueInput.min = 1;
      periodValueInput.removeAttribute('max');
    }
    updateOptionsForMode();
    validate();
  }));
  tabButtons.forEach((btn) => btn.addEventListener('click', () => {
    simMode = btn.dataset.mode;
    tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
    jockeyField.hidden = simMode !== 'jockey';
    venueField.hidden = simMode !== 'favorite';
    resultBox.innerHTML = '';
    updateOptionsForMode();
    validate();
  }));
  calcButton.addEventListener('click', () => {
    if (simMode === 'jockey') runJockeySimulation();
    else runFavoriteSimulation();
  });
}

function getPeriodMode() {
  return document.querySelector('input[name="period-mode"]:checked').value;
}

function validate() {
  const betAmount = Number(betAmountInput.value);
  const periodValue = Number(periodValueInput.value);

  let message = '';
  if (!betAmount || betAmount < BET_MIN || betAmount > BET_MAX) {
    message = `賭け金は${BET_MIN.toLocaleString()}円〜${BET_MAX.toLocaleString()}円の範囲で入力してください`;
  } else if (!periodValue || periodValue < 1) {
    message = '期間の値は1以上を入力してください';
  } else if (simMode === 'jockey' && !jockeySelect.value) {
    message = '騎手を選択してください';
  }

  errorBox.textContent = message;
  calcButton.disabled = Boolean(message);
  return !message;
}

function selectTargetRaces(mode, value, venue) {
  if (races.length === 0) return [];

  const pool = venue ? races.filter((race) => race.venue === venue) : races;

  if (mode === 'races') {
    return pool.slice(0, value);
  }

  if (mode === 'year') {
    return pool.filter((race) => race.year === value);
  }

  const latestYear = races[0].year;
  const cutoffYear = latestYear - value + 1;
  return pool.filter((race) => race.year >= cutoffYear);
}

function runJockeySimulation() {
  if (!validate()) return;

  const mode = getPeriodMode();
  const periodValue = Number(periodValueInput.value);
  const betAmount = Number(betAmountInput.value);
  const jockey = jockeySelect.value;

  const targetRaces = selectTargetRaces(mode, periodValue);

  let bets = 0;
  let investment = 0;
  let payout = 0;
  let wins = 0;
  let losses = 0;
  const winningRaces = [];

  for (const race of targetRaces) {
    const horse = race.horses.find((h) => h.jockey === jockey);
    if (!horse) continue;

    bets += 1;
    investment += betAmount;

    if (horse.position === 1) {
      payout += betAmount * horse.odds;
      wins += 1;
      winningRaces.push({
        race_name: race.race_name,
        year: race.year,
        horse_name: horse.name,
        odds: horse.odds,
      });
    } else {
      losses += 1;
    }
  }

  renderResult({ bets, investment, payout, wins, losses, winningRaces });
}

function runFavoriteSimulation() {
  if (!validate()) return;

  const mode = getPeriodMode();
  const periodValue = Number(periodValueInput.value);
  const betAmount = Number(betAmountInput.value);
  const venue = venueSelect.value;

  const targetRaces = selectTargetRaces(mode, periodValue, venue);

  let bets = 0;
  let investment = 0;
  let payout = 0;
  let wins = 0;
  let losses = 0;
  const winningRaces = [];

  for (const race of targetRaces) {
    const horse = race.horses.find((h) => h.popularity === 1);
    if (!horse) continue;

    bets += 1;
    investment += betAmount;

    if (horse.position === 1) {
      payout += betAmount * horse.odds;
      wins += 1;
      winningRaces.push({
        race_name: race.race_name,
        year: race.year,
        horse_name: horse.name,
        odds: horse.odds,
      });
    } else {
      losses += 1;
    }
  }

  renderResult({ bets, investment, payout, wins, losses, winningRaces });
}

function renderResult({ bets, investment, payout, wins, losses, winningRaces }) {
  if (bets === 0) {
    resultBox.innerHTML = '<p class="no-data">指定条件に合うレースはありませんでした</p>';
    return;
  }

  const returnRate = (payout / investment) * 100;
  const winRate = (wins / bets) * 100;

  const winRows = winningRaces
    .map((r) => `<tr><td>${r.race_name}</td><td>${r.year}</td><td>${r.horse_name}</td><td>${r.odds.toFixed(1)}倍</td></tr>`)
    .join('');

  resultBox.innerHTML = `
    <dl>
      <dt>対象レース数</dt><dd>${bets}件</dd>
      <dt>投資額</dt><dd>${Math.round(investment).toLocaleString()}円</dd>
      <dt>払戻金</dt><dd>${Math.round(payout).toLocaleString()}円</dd>
      <dt>還元率</dt><dd>${returnRate.toFixed(1)}%</dd>
      <dt>成績</dt><dd>${wins}勝${losses}敗</dd>
      <dt>勝率</dt><dd>${winRate.toFixed(1)}%</dd>
    </dl>
    <details class="win-list">
      <summary>勝利レース一覧を見る（${wins}件）</summary>
      <table>
        <thead><tr><th>レース名</th><th>年</th><th>馬名</th><th>単勝オッズ</th></tr></thead>
        <tbody>${winRows}</tbody>
      </table>
    </details>
  `;
}
