import { useAuth } from "../lib/auth";
import { Card, CardHeader, CardBody, Badge } from "../components/ui";

export default function Profile() {
  const { user, organization, role } = useAuth();
  return (
    <div className="mx-auto max-w-lg space-y-7">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Profile</h1>
      <Card>
        <CardHeader title="Your account" />
        <CardBody className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-2xl font-semibold text-white">
              {user?.name?.[0]}
            </div>
            <div>
              <div className="text-[16px] font-semibold text-slate-900 dark:text-white">{user?.name}</div>
              <div className="text-[13px] text-slate-400">{user?.email}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-5 text-[13px] dark:border-white/[0.06]">
            <div>
              <div className="text-slate-400">Organization</div>
              <div className="mt-0.5 font-medium text-slate-700 dark:text-slate-200">{organization?.name}</div>
            </div>
            <div>
              <div className="text-slate-400">Role</div>
              <div className="mt-1"><Badge tone="blue">{role}</Badge></div>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
