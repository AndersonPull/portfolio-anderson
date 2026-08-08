using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Portfolio.Modules.Emo.Models;

namespace Portfolio;

public class GameCatalogService : IGameCatalogService
{
    private readonly HttpClient _httpClient;

    public GameCatalogService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<List<GameEntry>> GetGamesAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync("emo/games.json");
            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<List<GameEntry>>(json) ?? [];
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine(ex.Message);
        }

        return [];
    }

    public async Task<GameEntry?> GetGameByIdAsync(string id)
    {
        var games = await GetGamesAsync();
        return games.FirstOrDefault(g => g.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
    }
}
