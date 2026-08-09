using System.Collections.Generic;

namespace Portfolio.Modules.Emo.Models;

public class GameEntry
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string System { get; set; } = string.Empty;
    public string Core { get; set; } = string.Empty;
    public string Rom { get; set; } = string.Empty;
    public string Cover { get; set; }
    public List<string> Buttons { get; set; }
}
