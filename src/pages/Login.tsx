import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { getKimiOAuthUrl } from "@/components/LoginSheet";
import PasswordAuthForm from "@/components/PasswordAuthForm";

export default function Login() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              // 先取 /api/oauth/nonce 构造 state；接口未就绪时内部自动降级，不阻断登录
              void getKimiOAuthUrl().then((url) => {
                window.location.href = url;
              });
            }}
          >
            Sign in with Kimi
          </Button>
          <PasswordAuthForm onSuccess={() => navigate("/")} />
        </CardContent>
      </Card>
    </div>
  );
}
