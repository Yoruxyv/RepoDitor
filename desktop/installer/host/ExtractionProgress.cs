using System;
using System.Globalization;

internal sealed class ExtractionProgress
{
    internal readonly string Session;
    internal readonly int Attempt;
    internal readonly int Percentage;

    internal ExtractionProgress(string session, int attempt, uint completed, uint total)
    {
        Session = session;
        Attempt = attempt;
        Percentage = (int)Math.Floor(completed * 100.0 / total);
    }
}

// Owns byte validation for one engine run. Fallback measures the same archive
// again, explicitly starting a new extraction attempt; it is never aggregated.
internal sealed class ExtractionMeasurements
{
    private readonly string _session;
    private uint _total;
    private uint _completed;
    private int _attempt;
    internal bool HasMeasurement { get { return _attempt != 0; } }
    internal bool ExtractionComplete { get { return HasMeasurement && _completed == _total; } }

    internal ExtractionMeasurements(string session) { _session = session; }

    internal bool TryAccept(string record, out ExtractionProgress progress)
    {
        progress = null;
        var fields = record.Split('|');
        uint completed, total;
        int attempt;
        if (fields.Length != 5 || fields[0] != "1" || fields[1] != _session ||
            !int.TryParse(fields[2], NumberStyles.None, CultureInfo.InvariantCulture, out attempt) ||
            !uint.TryParse(fields[3], NumberStyles.None, CultureInfo.InvariantCulture, out completed) ||
            !uint.TryParse(fields[4], NumberStyles.None, CultureInfo.InvariantCulture, out total) ||
            total == 0 || completed > total || attempt < 1 || attempt > 2 ||
            (_total != 0 && total != _total))
        {
            return false;
        }
        if (attempt == _attempt)
        {
            if (completed < _completed) return false;
        }
        else if (attempt != _attempt + 1 || (_attempt != 0 && completed != 0))
        {
            return false;
        }
        _attempt = attempt;
        _total = total;
        _completed = completed;
        progress = new ExtractionProgress(_session, attempt, completed, total);
        return true;
    }
}
