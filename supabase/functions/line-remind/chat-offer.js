export const TAICHUNG_OFFICE = {
  id: "taichung",
  label: "台中分公司",
  address: "台中市北屯區文心路四段698號6樓之1",
  arrival:
    "來請直接上電梯六樓進辦公室，告知面試會先填寫履歷(請自備原子筆)，再由主管面試，如人數較多將採用團體面試。",
  weather: "(如遇到國定假/颱風假會暫停面試，請再主動來訊預約)",
};

export function shortDate(ymd) {
  const [, m, d] = String(ymd).split("-");
  return Number(m) + "/" + Number(d);
}

export function zhClock(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const min = m ? m + "分" : "";
  if (h === 0) return "上午12點" + min;
  if (h < 12) return "上午" + h + "點" + min;
  if (h === 12) return "中午12點" + min;
  return "下午" + (h - 12) + "點" + min;
}

export function composeReminder(date, start, office = TAICHUNG_OFFICE) {
  return [
    `您好，提醒您明天（${shortDate(date)}）${zhClock(start)}面試。`,
    `地點：${office.address}`,
    "",
    office.arrival,
    office.weather,
  ].join("\n");
}
