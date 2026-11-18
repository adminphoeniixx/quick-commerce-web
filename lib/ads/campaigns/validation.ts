export function validateCampaignForm(input: {
  name: string;
  budget: string;
  noEnd: boolean;
  end: string;
  today?: string;
}): string {
  if (!input.name.trim()) return "Campaign name is required.";
  const budget = Number(input.budget);
  if (!Number.isFinite(budget) || budget <= 0) return "Enter a valid positive budget.";
  if (!input.noEnd && !input.end) return "Choose an end date or select no end date.";
  if (input.end && input.end < (input.today ?? new Date().toISOString().slice(0, 10))) return "End date cannot be in the past.";
  return "";
}

export function campaignFormFrom(row: { name: string; budget: number | null; endAt: string | null }) {
  return {
    name: row.name,
    budget: String(row.budget ?? ""),
    noEnd: row.endAt == null,
    end: row.endAt?.slice(0, 10) ?? "",
  };
}
