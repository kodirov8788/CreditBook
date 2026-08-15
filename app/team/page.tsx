import { requireTeamManager } from "@/lib/team";
import TeamManager from "@/components/team/team-manager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TeamPage() {
  const context = await requireTeamManager();
  return <TeamManager shopName={context.shopName} initialMembers={context.members} currentUserId={context.userId} />;
}
