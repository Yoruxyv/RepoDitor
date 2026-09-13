using System;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

// A single inbound, local-only pipe. Authentication uses the launched engine's
// kernel-reported PID, not an identity claimed by the sender or its records.
internal sealed class ExtractionProgressChannel : IDisposable
{
    internal const int MaximumRecordBytes = 128;
    private readonly NamedPipeServerStream _pipe;
    private readonly ExtractionMeasurements _measurements;
    private readonly Action<ExtractionProgress> _onProgress;
    private readonly CancellationTokenSource _waiting = new CancellationTokenSource();
    private readonly TaskCompletionSource<int> _engine = new TaskCompletionSource<int>();
    private readonly Task _reader;
    private volatile bool _finished;
    private volatile bool _disposed;
    internal readonly string Session;

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        internal int Length;
        internal IntPtr Descriptor;
        internal int InheritHandle;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
        string text, uint revision, out IntPtr descriptor, IntPtr size);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafePipeHandle CreateNamedPipe(string name, uint mode,
        uint pipeMode, uint instances, uint outputSize, uint inputSize,
        uint timeout, ref SecurityAttributes security);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint processId);

    internal ExtractionProgressChannel(string session, Action<ExtractionProgress> onProgress)
    {
        Session = session;
        _measurements = new ExtractionMeasurements(session);
        _onProgress = onProgress;
        IntPtr descriptor;
        var sid = WindowsIdentity.GetCurrent().User.Value;
        // FILE_WRITE_DATA + FILE_READ_ATTRIBUTES + SYNCHRONIZE. Windows also
        // checks read-attributes when opening the client; no pipe-instance right.
        // Administrators cover over-the-shoulder all-users elevation. There is
        // no Everyone/anonymous grant. The default integrity label is medium.
        var acl = "D:P(A;;0x00100082;;;" + sid +
            ")(A;;0x00100082;;;BA)(A;;0x00100082;;;SY)";
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor(acl, 1, out descriptor, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            var security = new SecurityAttributes {
                Length = Marshal.SizeOf(typeof(SecurityAttributes)), Descriptor = descriptor
            };
            // INBOUND | OVERLAPPED | FIRST_PIPE_INSTANCE; REJECT_REMOTE_CLIENTS.
            var handle = CreateNamedPipe("\\\\.\\pipe\\RepoDitor.Extraction." + session,
                0x40080001, 0x8, 1, 0, 1024, 0, ref security);
            if (handle.IsInvalid)
            {
                var error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new Win32Exception(error);
            }
            _pipe = new NamedPipeServerStream(PipeDirection.In, true, false, handle);
        }
        finally { LocalFree(descriptor); }
        _reader = ReadAsync();
    }

    internal void BindEngine(int processId) { _engine.SetResult(processId); }

    private async Task ReadAsync()
    {
        try
        {
            while (!_finished)
            {
                await _pipe.WaitForConnectionAsync(_waiting.Token).ConfigureAwait(false);
                var expectedPid = await _engine.Task.ConfigureAwait(false);
                uint clientPid;
                if (!GetNamedPipeClientProcessId(_pipe.SafePipeHandle, out clientPid) || clientPid != expectedPid)
                {
                    _pipe.Disconnect();
                    continue;
                }
                var buffer = new byte[MaximumRecordBytes];
                var record = new StringBuilder();
                int count;
                while ((count = await _pipe.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) != 0)
                {
                    for (var index = 0; index < count; index++)
                    {
                        var value = buffer[index];
                        if (value == 10)
                        {
                            ExtractionProgress progress;
                            if (_measurements.TryAccept(record.ToString(), out progress)) _onProgress(progress);
                            record.Clear();
                        }
                        else
                        {
                            if (value < 32 || value > 126 || record.Length >= MaximumRecordBytes)
                                throw new InvalidDataException("Invalid extraction telemetry framing.");
                            record.Append((char)value);
                        }
                    }
                }
                if (record.Length != 0) throw new InvalidDataException("Truncated extraction telemetry.");
                return;
            }
        }
        catch (OperationCanceledException) { if (!_finished && !_disposed) throw; }
        catch (ObjectDisposedException) { if (!_disposed) throw; }
        catch (IOException) { if (!_disposed) throw; }
    }

    internal async Task FinishAsync()
    {
        _finished = true;
        _waiting.Cancel();
        // A connected engine's buffered data drains to EOF after it exits.
        await _reader;
        if (!_measurements.ExtractionComplete)
            throw new InvalidOperationException("The installer supplied no complete extraction telemetry.");
    }

    public void Dispose()
    {
        _disposed = true;
        _waiting.Cancel();
        _engine.TrySetCanceled();
        _pipe.Dispose();
        _waiting.Dispose();
        // Observe faults on failure/cancel without blocking the UI thread.
        _reader.ContinueWith(task => { var ignored = task.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
    }
}
