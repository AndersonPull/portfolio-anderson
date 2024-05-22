using System.Collections.Generic;
using System.Net.Http;
using System.Threading.Tasks;
using Portfolio.Modules.Newsletter.Models;
using Newtonsoft.Json;
using System;

namespace Portfolio;

public class NewsletterService : INewsletterService
{
    private readonly HttpClient _httpClient;
    public NewsletterService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<List<ArticleModel>> GetArticlesAsyncAsync()
    {
        try
        {
            _httpClient.DefaultRequestHeaders.Add("Accept", "application/vnd.forem.api-v1+json");
            _httpClient.DefaultRequestHeaders.Add("api-key", Environment.GetEnvironmentVariable("DEVTO"));
            var response = await _httpClient.GetAsync("https://dev.to/api/articles/me/published");

            if(response.IsSuccessStatusCode)
                return JsonConvert
                .DeserializeObject<List<ArticleModel>>(await response.Content.ReadAsStringAsync());

        }
        catch (Exception ex)
        {
            Console.WriteLine(ex.Message);
        }

        return await GetArticlesMockAsync();
    }

    public async Task<List<ArticleModel>> GetArticlesMockAsync()
    {
        var resposta = await _httpClient.GetAsync("Mock/newsletter.json");
        if (resposta.IsSuccessStatusCode)
            return JsonConvert.DeserializeObject<List<ArticleModel>>(await resposta.Content.ReadAsStringAsync());

        return [];
    }
}
