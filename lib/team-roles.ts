export const TEAM_ROLES = ["shop_owner", "manager", "cashier", "accountant", "viewer"] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  shop_owner: "Do‘kon egasi",
  manager: "Menejer",
  cashier: "Kassir",
  accountant: "Hisobchi",
  viewer: "Kuzatuvchi",
};

export function teamRoleLabel(role: string) {
  return TEAM_ROLE_LABELS[role as TeamRole] ?? role;
}
