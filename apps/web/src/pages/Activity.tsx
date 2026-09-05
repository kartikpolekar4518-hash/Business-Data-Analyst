import { Card, CardBody } from "../components/ui";
import { ActivityFeed } from "../components/comments";

// The organization-wide trail. The entries have been recorded since the audit log
// was introduced; until now nothing could read them back.
export default function Activity() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Activity</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Everything your team has done — uploads, reports, comments, and settings changes.
        </p>
      </div>
      <Card><CardBody><ActivityFeed limit={100} /></CardBody></Card>
    </div>
  );
}
