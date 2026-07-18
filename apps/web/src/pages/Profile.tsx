import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Badge } from "../components/ui";

export default function Profile() {
  const { user, organization, role } = useAuth();
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Profile</h1>
      <Card>
        <CardHeader title="Your account" />
        <CardBody className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-2xl font-semibold text-white">{user?.name?.[0]}</div>
            <div><div className="text-lg font-semibold">{user?.name}</div><div className="text-sm text-slate-500">{user?.email}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
            <div><div className="text-slate-500">Organization</div><div className="font-medium">{organization?.name}</div></div>
            <div><div className="text-slate-500">Role</div><Badge tone="blue">{role}</Badge></div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
