import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getKimiOAuthUrl } from "@/components/LoginSheet";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
