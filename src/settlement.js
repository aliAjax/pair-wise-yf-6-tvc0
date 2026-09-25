// 结算：完工后按登记顺序核销垫付，不足记尾款，多出从最后一笔往前退
const toCents = (value) => Math.round(Number(value) * 100);
const toYuan = (cents) => cents / 100;

// 未完工（非已完成）或已结清的事项不能结算
export function canSettle(repair) {
  return repair.status === "done" && !repair.settlement;
}

// 按登记顺序逐笔核销实付总额：
// - 每笔垫付依次冲抵，先登记的先用掉；
// - 垫付合计不足的部分记为尾款（还需补付）；
// - 垫付合计超出的部分自然落在最后几笔上，即从最后一笔往前退回。
export function computeSettlement(advances, total) {
  let remaining = toCents(total);

  const lines = advances.map((advance, index) => {
    const amount = toCents(advance.amount);
    const applied = Math.max(0, Math.min(amount, remaining));
    remaining -= applied;
    return {
      advanceId: advance.id,
      order: index + 1,
      payer: advance.payer,
      purpose: advance.purpose,
      amount: toYuan(amount),
      applied: toYuan(applied),
      refund: toYuan(amount - applied)
    };
  });

  const advanceTotal = advances.reduce((sum, advance) => sum + toCents(advance.amount), 0);

  return {
    total: toYuan(toCents(total)),
    advanceTotal: toYuan(advanceTotal),
    lines,
    tail: toYuan(Math.max(remaining, 0)),
    refundTotal: toYuan(Math.max(advanceTotal - toCents(total), 0)),
    settledAt: new Date().toISOString()
  };
}
