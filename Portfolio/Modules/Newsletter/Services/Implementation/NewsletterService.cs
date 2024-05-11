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

    public async Task<List<ArticleModel>> GetAticlesAsync()
    {
        try
        {
            Console.WriteLine("API");
            Console.WriteLine(Environment.GetEnvironmentVariable("APIKEY"));

            Console.WriteLine("API");
            Console.WriteLine(Environment.GetEnvironmentVariable("DEVTO"));

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

        return new List<ArticleModel>();
    }
}
