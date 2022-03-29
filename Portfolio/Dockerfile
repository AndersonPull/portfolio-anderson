FROM mcr.microsoft.com/dotnet/sdk:5.0 AS build
WORKDIR /src
COPY Portfolio.csproj .
RUN dotnet restore Portfolio.csproj
COPY . .
RUN dotnet build Portfolio.csproj -c Release -o /app/build

FROM build AS publish
RUN dotnet publish Portfolio.csproj -c Release -o /app/publish

FROM nginx:alpine AS final
WORKDIR /usr/share/nginx/html
COPY --from=publish /app/publish/wwwroot .

CMD ASPNETCORE_URLS="http://*:$PORT" dotnet portfolio.dll