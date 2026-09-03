import { AuthRecoveryView } from "@/features/auth-recovery-view";

export const metadata = {
  title: "新しいパスワード",
};

export default function ResetPasswordPage() {
  return <AuthRecoveryView mode="update" />;
}
