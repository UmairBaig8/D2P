import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MailCheck, MailX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { sendTestEmail } from '@/lib/site';

type TestResult = { ok: boolean; provider?: string; error?: string };

export function EmailTestCard() {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    const recipient = to.trim();
    if (!recipient) {
      toast.error('Enter a recipient email address.');
      return;
    }
    setBusy(true);
    setResult(null);
    const res = await sendTestEmail(recipient);
    setResult(res);
    setBusy(false);
    if (res.ok) toast.success(`Test email sent via ${res.provider ?? 'provider'}.`);
    else toast.error(`Test failed: ${res.error ?? 'unknown error'}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg font-bold tracking-wide">EMAIL DELIVERY TEST</CardTitle>
        <CardDescription>Send a test email through the configured provider (Hostinger Mail API, falling back to Resend).</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={run} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="email-test-to">RECIPIENT</Label>
            <Input id="email-test-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" required autoComplete="off" />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy} variant="outline">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <MailCheck className="size-4" />}
              {busy ? 'SENDING…' : 'SEND TEST EMAIL'}
            </Button>
            {result ? (
              result.ok ? (
                <Badge variant="secondary">OK · {result.provider}</Badge>
              ) : (
                <Badge variant="destructive">
                  <MailX className="size-3" /> FAILED
                </Badge>
              )
            ) : null}
          </div>
          {result && !result.ok ? <p className="text-xs text-destructive">{result.error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
