import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Badge } from "../components/ui";

export default function Profile() {
  const { user, organization, role } = useAuth();
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-heading-1 font-bold">Profile</h1>
      <Card>
        <CardHeader title="Your account" />
        <CardBody className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-heading-1 font-semibold text-accent-fg">{user?.name?.[0]}</div>
            <div><div className="text-heading-3 font-semibold">{user?.name}</div><div className="text-body text-ink-faint">{user?.email}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-rule-soft pt-4 text-body">
            <div><div className="text-ink-faint">Organization</div><div className="font-medium">{organization?.name}</div></div>
            <div><div className="text-ink-faint">Role</div><Badge tone="blue">{role}</Badge></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
