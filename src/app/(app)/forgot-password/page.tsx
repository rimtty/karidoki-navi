import { AuthRecoveryView } from "@/features/auth-recovery-view";

export const metadata = {
  title: "パスワード再設定",
};

export default function ForgotPasswordPage() {
  return <AuthRecoveryView mode="request" />;
}
