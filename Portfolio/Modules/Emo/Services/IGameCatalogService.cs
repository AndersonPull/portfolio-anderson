using System.Collections.Generic;
using System.Threading.Tasks;
using Portfolio.Modules.Emo.Models;

namespace Portfolio;

public interface IGameCatalogService
{
    Task<List<GameEntry>> GetGamesAsync();
    Task<GameEntry?> GetGameByIdAsync(string id);
}
