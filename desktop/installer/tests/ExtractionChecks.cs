using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

internal static class ExtractionChecks
{
    private const string Session = "0123456789abcdef0123456789abcdef";
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafePipeHandle CreateFile(string path, uint access, uint share,
        IntPtr security, uint disposition, uint flags, IntPtr template);

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    private static void Measurements()
    {
        var values = new ExtractionMeasurements(Session);
        ExtractionProgress progress;
        foreach (var completed in new[] { 0, 53, 100 })
        {
            Check(values.TryAccept("1|" + Session + "|1|" + completed + "|100", out progress), "Valid bytes rejected.");
            Check(progress.Percentage == completed, "Incorrect measured percentage.");
            Check(values.ExtractionComplete == (completed == 100), "Incomplete bytes satisfied extraction completion.");
        }
        foreach (var bad in new[] {
            "1|" + Session + "|1|99|100", "1|" + Session + "|1|100|101",
            "1|" + Session + "|1|101|100", "1|" + Session + "|1|0|0",
            "1|" + Session + "|1|-1|100", "1|" + Session + "|1|0|-1",
            "1|" + Session + "|1|0|4294967296", "1|" + Session + "|1|NaN|100",
            "1|" + Session + "|1|Infinity|100",
            "1|" + Session + "|1|1.5|100", "1|" + Session + "|1|+1|100",
            "1|" + Session + "|2|57|100", "1|" + Session + "|3|0|100",
            "1|ffffffffffffffffffffffffffffffff|1|100|100", "{}", "1|" + Session + "|1|100|100|extra"
        }) Check(!values.TryAccept(bad, out progress), "Invalid telemetry accepted: " + bad);
        Check(values.TryAccept("1|" + Session + "|2|0|100", out progress) && progress.Percentage == 0,
            "Genuine fallback attempt did not reset.");
        Check(!values.TryAccept("1|" + Session + "|1|100|100", out progress), "Old attempt accepted.");
        var retry = new ExtractionMeasurements("ffffffffffffffffffffffffffffffff");
        Check(!retry.TryAccept("1|" + Session + "|1|100|100", out progress), "Old run accepted by Retry.");
        var fraction = new ExtractionMeasurements(Session);
        Check(fraction.TryAccept("1|" + Session + "|1|2|3", out progress) && progress.Percentage == 66, "Incorrect display rounding.");
        var ceiling = new ExtractionMeasurements(Session);
        Check(ceiling.TryAccept("1|" + Session + "|1|4294967295|4294967295", out progress) && progress.Percentage == 100,
            "Valid UInt32 ceiling rejected.");
    }

    private static async Task RejectFrame(string record, bool unrelatedSender)
    {
        var session = Guid.NewGuid().ToString("N");
        var accepted = false;
        using (var channel = new ExtractionProgressChannel(session, value => accepted = true))
        {
            channel.BindEngine(Process.GetCurrentProcess().Id + (unrelatedSender ? 1 : 0));
            var handle = CreateFile("\\\\.\\pipe\\RepoDitor.Extraction." + session,
                0x00100082, 0, IntPtr.Zero, 3, 0x00100000, IntPtr.Zero);
            Check(!handle.IsInvalid, "Fixture client could not access its restricted pipe: Win32 error " + Marshal.GetLastWin32Error());
            using (var client = new NamedPipeClientStream(PipeDirection.Out, false, true, handle))
            {
                var bytes = Encoding.ASCII.GetBytes(record.Replace("SESSION", session));
                client.Write(bytes, 0, bytes.Length);
            }
            var rejected = false;
            try { await channel.FinishAsync(); }
            catch (InvalidOperationException) { rejected = true; }
            catch (InvalidDataException) { rejected = true; }
            Check(rejected && !accepted, "Malformed or unrelated sender supplied trusted progress.");
        }
    }

    private static async Task Probe(string executable, string root, bool fallback)
    {
        var session = Guid.NewGuid().ToString("N");
        var samples = new List<ExtractionProgress>();
        var output = Path.Combine(root, fallback ? "fallback" : "normal");
        Directory.CreateDirectory(output);
        FileStream locked = null;
        if (fallback) locked = new FileStream(Path.Combine(output, "synthetic-0.bin"),
            FileMode.Create, FileAccess.Write, FileShare.None);
        try
        {
            using (var channel = new ExtractionProgressChannel(session, progress => samples.Add(progress)))
            {
                var arguments = "/S --repoditor-progress=" + session +
                    " --repoditor-progress-host=" + Process.GetCurrentProcess().Id + " /D=" + output;
                using (var engine = Process.Start(new ProcessStartInfo(executable, arguments) { UseShellExecute = false }))
                {
                    channel.BindEngine(engine.Id);
                    Check(engine.WaitForExit(30000), "Synthetic extraction exceeded its completion deadline.");
                    Check(engine.ExitCode == 0, "Synthetic extraction engine failed: " + engine.ExitCode);
                    await channel.FinishAsync();
                }
            }
        }
        finally { if (locked != null) locked.Dispose(); }
        Check(samples.Count > 2 && samples.Exists(value => value.Percentage > 0 && value.Percentage < 100),
            "No genuine intermediate extraction samples: " + string.Join(",", samples.ConvertAll(value => value.Attempt + ":" + value.Percentage)));
        var last = -1;
        var attempt = 1;
        foreach (var sample in samples)
        {
            if (sample.Attempt != attempt) { Check(sample.Attempt == 2 && sample.Percentage == 0, "Untruthful fallback reset."); attempt = 2; last = -1; }
            Check(sample.Percentage >= last, "Real extraction progress decreased within an attempt.");
            last = sample.Percentage;
        }
        Check(last == 100 && attempt == (fallback ? 2 : 1), "Extraction callback coverage incomplete.");
        Check(File.ReadAllText(Path.Combine(output, "registers.txt")) == "preserved", "Callback corrupted NSIS registers.");
        if (!fallback)
        {
            for (var index = 0; index < 8; index++)
            {
                var source = File.ReadAllBytes(Path.Combine(root, "input", "synthetic-" + index + ".bin"));
                var actual = File.ReadAllBytes(Path.Combine(output, "synthetic-" + index + ".bin"));
                Check(Convert.ToBase64String(source) == Convert.ToBase64String(actual), "Extracted payload differs.");
            }
        }
        Console.WriteLine("PASS " + (fallback ? "fallback" : "normal") + ": " + samples.Count + " genuine callback samples, monotonic per attempt, measured 100%.");
    }

    private static async Task Run(string[] args)
    {
        Measurements();
        await RejectFrame("{malformed}\n", false);
        await RejectFrame(new string('x', ExtractionProgressChannel.MaximumRecordBytes + 1) + "\n", false);
        await RejectFrame("1|SESSION|1|53|100", false);
        await RejectFrame("\0\n", false);
        await RejectFrame("1|SESSION|1|53|100\n", true);
        await RejectServer(args[0], args[1]);
        await Probe(args[0], args[1], false);
        await Probe(args[0], args[1], true);
        await VerifyCompletion(args[0], args[1]);
        Console.WriteLine("PASS: native byte bounds, rounding, attempts/Retry, malformed framing and kernel PID authentication.");
    }

    private static async Task RejectServer(string executable, string root)
    {
        var session = Guid.NewGuid().ToString("N");
        var accepted = false;
        using (var channel = new ExtractionProgressChannel(session, progress => accepted = true))
        using (var engine = Process.Start(executable, "/S --repoditor-progress=" + session +
            " --repoditor-progress-host=" + (Process.GetCurrentProcess().Id + 1) + " /D=" + Path.Combine(root, "wrong-server")))
        {
            channel.BindEngine(engine.Id);
            Check(engine.WaitForExit(30000) && engine.ExitCode == 3, "NSIS accepted the wrong pipe server PID.");
            var refused = false;
            try { await channel.FinishAsync(); } catch (InvalidOperationException) { refused = true; }
            Check(refused && !accepted, "Server authentication failure supplied accepted extraction progress.");
        }
    }

    private static async Task VerifyCompletion(string executable, string root)
    {
        var options = Arguments.Parse(new[] { "--engine", executable, "--registry-key",
            "Software\\RepoDitorSyntheticChecks\\" + Guid.NewGuid().ToString("N") });
        var stages = new List<InstallerState>();
        var percentages = new List<int>();
        using (var engine = new InstallerEngine(options, state => stages.Add(state), value => percentages.Add(value.Percentage)))
        {
            string previousSession = null;
            for (var retry = 0; retry < 2; retry++)
            {
                stages.Clear(); percentages.Clear();
                var refused = false;
                try { await engine.RunAsync("current", Path.Combine(root, "verification-" + retry)); }
                catch (InvalidOperationException) { refused = true; }
                Check(refused && percentages.Contains(100) && stages.Contains(InstallerState.Finalizing) &&
                    !stages.Contains(InstallerState.Success), "Measured 100% bypassed authoritative registration verification.");
                Check(engine.ProgressSession != previousSession, "Retry reused its native progress session.");
                previousSession = engine.ProgressSession;
            }
        }
        Console.WriteLine("PASS: measured 100% still fails missing registration; native Retry creates a fresh session.");
    }

    private static int Main(string[] args)
    {
        try { Run(args).GetAwaiter().GetResult(); return 0; }
        catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}
